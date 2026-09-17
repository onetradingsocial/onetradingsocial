// app/tests/unit/lifecycle-cron-resilience.test.ts
//
// Two production failures of api/cron/lifecycle-emails, pinned:
//
//   2026-09-09..11  The run hit its 60s maxDuration. Vercel killed it before the
//                   summary, so no cron_runs row was written, and the sections
//                   scheduled last (trial notices, welcomes) silently slipped.
//   2026-09-15      Resend's daily quota was spent before the run. Every send
//                   returned 429, and every trial email was STAMPED as handled
//                   anyway — five trial emails that will never be retried.
//
// The route is driven with a chainable fake Supabase client, because the thing
// under test is control flow: what gets stamped, what gets deferred, and that
// the run is always recorded.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isTransientEmailError } from '@/lib/server/email'

const DAY = 864e5
const T0 = Date.parse('2026-09-17T13:37:00.000Z')

type Row = Record<string, unknown>
let tables: Record<string, Row[]> = {}
const updates: Array<{ table: string; payload: Row }> = []

function fakeFrom(table: string) {
  const state: { op: 'select' | 'update'; payload: Row | null } = { op: 'select', payload: null }
  const result = () => {
    if (state.op === 'update') {
      updates.push({ table, payload: state.payload! })
      return { data: null, error: null, count: 0 }
    }
    return { data: tables[table] ?? [], error: null, count: (tables[table] ?? []).length }
  }
  const b: Record<string, unknown> = new Proxy({}, {
    get(_t, prop: string) {
      if (prop === 'then') return (res: (v: unknown) => void, rej: (e: unknown) => void) => Promise.resolve(result()).then(res, rej)
      if (prop === 'update') return (p: Row) => { state.op = 'update'; state.payload = p; return b }
      if (prop === 'maybeSingle' || prop === 'single') return async () => ({ data: (tables[table] ?? [])[0] ?? null, error: null })
      return () => b
    },
  })
  return b
}

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: fakeFrom,
    rpc: async () => ({ data: null, error: null }),
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: `${id}@example.com` } } }) } },
  }),
}))

const sendEmail = vi.fn<(a: { to: string; subject: string; html: string }) => Promise<{ sent: boolean; error?: string }>>()
vi.mock('@/lib/server/email', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/server/email')>()
  return { ...real, sendEmail: (a: { to: string; subject: string; html: string }) => sendEmail(a) }
})

const recordCronRun = vi.fn()
vi.mock('@/lib/server/cron-runs', () => ({ recordCronRun: (...a: unknown[]) => recordCronRun(...a) }))
vi.mock('@/lib/cron', () => ({ authorizedCron: () => true }))
vi.mock('@/lib/server/welcome-email', () => ({ sendWelcomeEmail: async () => ({ sent: false, reason: 'already_sent' }) }))
vi.mock('@/lib/notifications', () => ({ insertSystemNotification: vi.fn(async () => {}) }))
vi.mock('@/lib/server/entitlements', () => ({ getTierMap: async () => new Map() }))
vi.mock('@/lib/server/feature-flags', () => ({ getFeatureFlags: async () => ({}) }))
vi.mock('@/lib/stripe', () => ({ getStripe: () => ({}) }))
vi.mock('@/lib/server/billing-reconcile', () => ({ reconcileBilling: async () => ({}) }))
vi.mock('@/lib/server/log', () => ({ logError: vi.fn(), logWarn: vi.fn(), logInfo: vi.fn() }))

async function run() {
  const mod = await import('@/app/api/cron/lifecycle-emails/route')
  return mod.GET(new Request('https://app.example.com/api/cron/lifecycle-emails'))
}

/** One real user on a card-free local trial, `day` days in, day-7 email sent. */
function trialist(day: number): Row {
  return {
    id: 'u1', username: 'sam', display_name: 'Sam', created_at: new Date(T0 - 30 * DAY).toISOString(),
    last_weekly_email: new Date(T0 - DAY).toISOString(), last_recovery_email: new Date(T0 - DAY).toISOString(),
    notification_prefs: {}, trial_started_at: new Date(T0 - day * DAY - 3600e3).toISOString(),
    trial_ack_at: null, trial_email_stage: 7, last_trial_email: null, welcome_email_at: new Date(T0 - 30 * DAY).toISOString(),
  }
}

const stageStamps = () => updates.filter((u) => u.table === 'profiles' && 'trial_email_stage' in u.payload)
const recorded = () => recordCronRun.mock.calls[0][2] as { ok: boolean; processed: Record<string, number> }

beforeEach(() => {
  vi.clearAllMocks()
  updates.length = 0
  tables = { profiles: [trialist(12)], subscriptions: [], trades: [], broker_accounts: [] }
  sendEmail.mockResolvedValue({ sent: true })
  vi.spyOn(Date, 'now').mockReturnValue(T0)
  process.env.CRON_SECRET = 'x'
})
afterEach(() => { vi.restoreAllMocks() })

describe('a transient send failure is retried tomorrow, not stamped away', () => {
  it('leaves the trial stage unstamped on a 429', async () => {
    sendEmail.mockImplementation(async ({ subject }) =>
      /trial/i.test(subject) ? { sent: false, error: 'resend_429' } : { sent: true })

    await run()

    expect(sendEmail.mock.calls.some(([a]) => /trial ends/i.test(a.subject))).toBe(true)
    expect(stageStamps()).toEqual([])
    expect(recorded().processed.retryTomorrow).toBe(1)
  })

  it('still stamps on a permanent failure, so a missing provider cannot flood later', async () => {
    sendEmail.mockResolvedValue({ sent: false, error: 'no_provider' })
    await run()
    expect(stageStamps().map((u) => u.payload.trial_email_stage)).toEqual([12])
  })

  it('stamps on success', async () => {
    await run()
    expect(stageStamps().map((u) => u.payload.trial_email_stage)).toEqual([12])
    expect(recorded().ok).toBe(true)
  })
})

describe('the pre-charge notice names the days actually left', () => {
  it('says "tomorrow" when the day-12 notice goes out on day 13', async () => {
    tables.profiles = [trialist(13)]
    await run()
    const subjects = sendEmail.mock.calls.map(([a]) => a.subject)
    expect(subjects).toContain('Your TradingSocial Pro trial ends tomorrow')
    expect(subjects.join('|')).not.toMatch(/in 2 days/)
  })
})

describe('the time budget', () => {
  it('defers remaining work and still records the run', async () => {
    // First read is the run's start; every later one is past the budget.
    let first = true
    vi.spyOn(Date, 'now').mockImplementation(() => { if (first) { first = false; return T0 } return T0 + 50_000 })

    const res = await run()

    expect(res.status).toBe(200)
    expect(recordCronRun).toHaveBeenCalledTimes(1)
    expect(recorded().ok).toBe(false)
    expect(recorded().processed.deferred).toBeGreaterThan(0)
    expect(sendEmail).not.toHaveBeenCalled()
    // Nothing deferred was stamped, so tomorrow's run picks it all up.
    expect(stageStamps()).toEqual([])
  })

  it('sends trial notices before digests and nudges', async () => {
    // Lapsed and never nudged, so the recovery branch has something to send.
    tables.profiles = [{ ...trialist(12), last_recovery_email: null, last_weekly_email: null }]
    await run()
    const subjects = sendEmail.mock.calls.map(([a]) => a.subject)
    const trialAt = subjects.findIndex((s) => /trial/i.test(s))
    const otherAt = subjects.findIndex((s) => !/trial/i.test(s))
    expect(trialAt).toBeGreaterThanOrEqual(0)
    expect(otherAt).toBeGreaterThanOrEqual(0)
    expect(trialAt).toBeLessThan(otherAt)
  })
})

describe('isTransientEmailError', () => {
  it('treats rate limits, server errors and network failures as transient', () => {
    for (const e of ['resend_429', 'resend_500', 'resend_503', 'fetch failed', 'send_failed']) {
      expect(isTransientEmailError(e)).toBe(true)
    }
  })
  it('treats configuration and request errors as permanent', () => {
    for (const e of [undefined, 'no_provider', 'no_address', 'resend_400', 'resend_403', 'resend_422']) {
      expect(isTransientEmailError(e)).toBe(false)
    }
  })
})
