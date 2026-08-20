import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guards for server-action throttling (WS11; audit item 10 finding 8).
 *
 * Four properties are tested here, and they are the four the finding turns on:
 *
 *   1. the limit actually triggers;
 *   2. it resets when its window rolls;
 *   3. the bucket key comes from the SESSION and never from client input —
 *      the `api/track` bypass (finding 3) must not be reintroduced;
 *   4. the fail-OPEN decision, including its floor: a degraded limiter still
 *      binds in-process, it does not become no limiter at all.
 */

const rpc = vi.fn()
const headerStore = new Map<string, string>()

/** The service client is the limiter's store AND, in the call-site tests below,
 *  the client an action writes through. One mock serves both. */
const serviceFrom = vi.fn()
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ rpc, from: serviceFrom }),
}))
vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (k: string) => headerStore.get(k.toLowerCase()) ?? null }),
}))

type Mod = typeof import('@/lib/server/action-throttle')

async function fresh(): Promise<Mod> {
  vi.resetModules()
  return import('@/lib/server/action-throttle')
}

/** The durable tier answering "allowed"; the local tier still decides below it. */
function durableAllows() {
  rpc.mockResolvedValue({ data: [{ allowed: true, retry_after: 0 }], error: null })
}

const UID = '11111111-2222-4333-8444-555555555555'
const OTHER_UID = '99999999-8888-4777-8666-555555555555'

beforeEach(() => {
  rpc.mockReset()
  serviceFrom.mockReset()
  headerStore.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// 1 + 2 — the limit triggers, and it resets after the window
// ---------------------------------------------------------------------------

describe('allowAction — the limit', () => {
  it('refuses once the durable tier says the budget is spent', async () => {
    const { allowAction, POST_BUDGET } = await fresh()
    rpc.mockResolvedValue({ data: [{ allowed: false, retry_after: 90 }], error: null })

    const v = await allowAction(POST_BUDGET, UID)
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.retryAfter).toBe(90)
      expect(v.message).toBe("You're doing that too quickly. Try again in 2 minutes.")
    }
  })

  it('triggers on the in-process tier at exactly max + 1', async () => {
    const { allowAction, REPORT_BUDGET } = await fresh()
    // Durable tier unavailable, so the local bucket is the binding verdict.
    rpc.mockRejectedValue(new Error('down'))

    for (let i = 0; i < REPORT_BUDGET.max; i++) {
      expect((await allowAction(REPORT_BUDGET, UID)).ok).toBe(true)
    }
    expect((await allowAction(REPORT_BUDGET, UID)).ok).toBe(false)
  })

  it('resets after the window rolls', async () => {
    const { allowAction, REPORT_BUDGET } = await fresh()
    rpc.mockRejectedValue(new Error('down'))
    vi.useFakeTimers()

    for (let i = 0; i < REPORT_BUDGET.max; i++) await allowAction(REPORT_BUDGET, UID)
    expect((await allowAction(REPORT_BUDGET, UID)).ok).toBe(false)

    vi.advanceTimersByTime(REPORT_BUDGET.windowMs + 1_000)
    expect((await allowAction(REPORT_BUDGET, UID)).ok).toBe(true)
  })

  it('one user spending their budget never refuses another user', async () => {
    const { allowAction, REPORT_BUDGET } = await fresh()
    rpc.mockRejectedValue(new Error('down'))
    for (let i = 0; i <= REPORT_BUDGET.max; i++) await allowAction(REPORT_BUDGET, UID)
    expect((await allowAction(REPORT_BUDGET, OTHER_UID)).ok).toBe(true)
  })

  it('budgets do not share a bucket', async () => {
    const { allowAction, REPORT_BUDGET, EXPORT_BUDGET } = await fresh()
    rpc.mockRejectedValue(new Error('down'))
    for (let i = 0; i <= EXPORT_BUDGET.max; i++) await allowAction(EXPORT_BUDGET, UID)
    expect((await allowAction(EXPORT_BUDGET, UID)).ok).toBe(false)
    expect((await allowAction(REPORT_BUDGET, UID)).ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 3 — the key is session-derived, never client-supplied
// ---------------------------------------------------------------------------

describe('the bucket key', () => {
  it('keys on the authenticated user id when there is a session', async () => {
    const { allowAction, POST_BUDGET } = await fresh()
    durableAllows()
    await allowAction(POST_BUDGET, UID)
    expect(rpc.mock.calls[0][1].p_key).toBe(`act:post:u:${UID}`)
  })

  it('keys on the forwarded IP only when there is no session', async () => {
    const { allowAction, SEARCH_BUDGET } = await fresh()
    durableAllows()
    headerStore.set('x-forwarded-for', '203.0.113.7, 10.0.0.1')
    await allowAction(SEARCH_BUDGET, null)
    expect(rpc.mock.calls[0][1].p_key).toBe('act:search:ip:203.0.113.7')
  })

  it('never produces an empty key when the IP is unknowable', async () => {
    const { allowAction, SEARCH_BUDGET } = await fresh()
    durableAllows()
    await allowAction(SEARCH_BUDGET, null)
    expect(rpc.mock.calls[0][1].p_key).toBe('act:search:ip:unknown')
  })

  it('does NOT let the IP header displace a session id', async () => {
    // The bypass shape: a caller who can set x-forwarded-for must not be able
    // to move themselves out of their own user bucket.
    const { allowAction, POST_BUDGET } = await fresh()
    durableAllows()
    headerStore.set('x-forwarded-for', '198.51.100.1')
    await allowAction(POST_BUDGET, UID)
    expect(rpc.mock.calls[0][1].p_key).toBe(`act:post:u:${UID}`)
  })

  it('DISCARDS a non-UUID id rather than minting a bucket per string', async () => {
    // This is the api/track bypass (item 10 finding 3): a client-chosen value as
    // the key means a fresh value buys a fresh bucket. If a call site ever
    // passed an action argument by mistake, it must land in the shared IP
    // bucket, not in a private one it named itself.
    const { allowAction, POST_BUDGET, actionKey } = await fresh()
    durableAllows()
    headerStore.set('x-forwarded-for', '203.0.113.7')

    await allowAction(POST_BUDGET, 'attacker-chosen-value')
    expect(rpc.mock.calls[0][1].p_key).toBe('act:post:ip:203.0.113.7')

    expect(actionKey(POST_BUDGET, 'not-a-uuid', '1.2.3.4')).toBe('act:post:ip:1.2.3.4')
    expect(actionKey(POST_BUDGET, UID, '1.2.3.4')).toBe(`act:post:u:${UID}`)
  })

  it('rotating a client-supplied value cannot refill the bucket', async () => {
    const { allowAction, EXPORT_BUDGET } = await fresh()
    rpc.mockRejectedValue(new Error('down'))
    headerStore.set('x-forwarded-for', '203.0.113.9')
    for (let i = 0; i <= EXPORT_BUDGET.max; i++) {
      await allowAction(EXPORT_BUDGET, `forged-${i}`)
    }
    // Every forged id collapsed onto the one IP bucket, so it is now spent.
    expect((await allowAction(EXPORT_BUDGET, 'forged-brand-new')).ok).toBe(false)
  })

  it('passes the budget through to the store unmodified', async () => {
    const { allowAction, MESSAGE_BUDGET } = await fresh()
    durableAllows()
    await allowAction(MESSAGE_BUDGET, UID)
    expect(rpc).toHaveBeenCalledWith('consume_rate_limit', {
      p_key: `act:message:u:${UID}`,
      p_max: MESSAGE_BUDGET.max,
      p_window_ms: MESSAGE_BUDGET.windowMs,
    })
  })
})

/**
 * The guard that matters more than the assertions above: it walks the real
 * action files and fails if any `allowAction(...)` call passes something that
 * did not come from the session. Same idea as the console.* walker in
 * redact.test.ts — a comment does not stop drift, a failing test does.
 */
describe('every call site keys on the session (source guard)', () => {
  const ACTIONS_DIR = join(process.cwd(), 'src', 'app', 'actions')

  /**
   * The only accepted second arguments. Each is a value read on the server:
   *   user.id / user?.id      -> supabase.auth.getUser()
   *   ctx.user.id             -> requireTemplates(), which itself calls getUser()
   *   su?.id ?? null          -> getSessionUser(), local JWT verification
   *   null                    -> genuinely anonymous, falls back to IP
   */
  const ALLOWED = new Set([
    'user.id',
    'user?.id ?? null',
    'ctx.user.id',
    'su?.id ?? null',
    'null',
  ])

  it('passes only session-derived identifiers', () => {
    const offenders: string[] = []
    let calls = 0

    for (const file of readdirSync(ACTIONS_DIR).filter((f) => f.endsWith('.ts'))) {
      const src = readFileSync(join(ACTIONS_DIR, file), 'utf8')
      for (const m of src.matchAll(/allowAction\(\s*([A-Z_]+)\s*,\s*([^)]*?)\s*\)/g)) {
        calls++
        const arg = m[2]
        if (!ALLOWED.has(arg)) offenders.push(`${file}: allowAction(${m[1]}, ${arg})`)
      }
    }

    expect(offenders).toEqual([])
    // Fails loudly if the wiring is deleted rather than silently passing on an
    // empty set.
    expect(calls).toBeGreaterThan(40)
  })

  it('leaves the auth actions WS2 wired on their own throttle', () => {
    const auth = readFileSync(join(ACTIONS_DIR, 'auth.ts'), 'utf8')
    expect(auth).not.toContain('allowAction')
    expect(auth).toContain('allowAuthAttempt(SIGNUP_BUDGET, email)')
    expect(auth).toContain('allowAuthAttempt(LOGIN_BUDGET, email)')
    expect(auth.match(/allowAuthAttempt\(RESET_BUDGET, email\)/g)).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// 4 — fail open, and the floor under it
// ---------------------------------------------------------------------------

describe('fail-open behaviour when the limiter itself errors', () => {
  it('ALLOWS the action when the store throws', async () => {
    const { allowAction, POST_BUDGET } = await fresh()
    rpc.mockRejectedValue(new Error('connection reset'))
    expect(await allowAction(POST_BUDGET, UID)).toEqual({ ok: true })
  })

  it('ALLOWS the action when the RPC returns an error row', async () => {
    const { allowAction, POST_BUDGET } = await fresh()
    rpc.mockResolvedValue({ data: null, error: { code: '57014', message: 'statement timeout' } })
    expect(await allowAction(POST_BUDGET, UID)).toEqual({ ok: true })
  })

  it('degrades to per-instance counting rather than to no counting', async () => {
    // The floor. Fail-open must not mean unlimited: the in-process bucket is
    // consumed on every call, so a store outage lowers protection from
    // cross-instance to per-instance and no further.
    const { allowAction, EXPORT_BUDGET } = await fresh()
    rpc.mockRejectedValue(new Error('down'))
    for (let i = 0; i < EXPORT_BUDGET.max; i++) {
      expect((await allowAction(EXPORT_BUDGET, UID)).ok).toBe(true)
    }
    const refused = await allowAction(EXPORT_BUDGET, UID)
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.message).toMatch(/Try again in/)
  })

  it('an outage mid-window does not hand the caller a fresh bucket', async () => {
    const { allowAction, EXPORT_BUDGET } = await fresh()
    durableAllows()
    for (let i = 0; i < EXPORT_BUDGET.max; i++) await allowAction(EXPORT_BUDGET, UID)
    rpc.mockRejectedValue(new Error('down'))
    expect((await allowAction(EXPORT_BUDGET, UID)).ok).toBe(false)
  })

  it('fails open even when the header lookup is unavailable too', async () => {
    const { allowAction, SEARCH_BUDGET } = await fresh()
    rpc.mockRejectedValue(new Error('down'))
    await expect(allowAction(SEARCH_BUDGET, null)).resolves.toEqual({ ok: true })
  })
})

// ---------------------------------------------------------------------------
// The user-facing message
// ---------------------------------------------------------------------------

describe('throttleMessage', () => {
  it('names a wait the user can act on', async () => {
    const { throttleMessage } = await fresh()
    expect(throttleMessage(1)).toBe("You're doing that too quickly. Try again in 1 second.")
    expect(throttleMessage(30)).toBe("You're doing that too quickly. Try again in 30 seconds.")
    expect(throttleMessage(60)).toBe("You're doing that too quickly. Try again in 1 minute.")
    expect(throttleMessage(600)).toBe("You're doing that too quickly. Try again in 10 minutes.")
    expect(throttleMessage(3600)).toBe("You're doing that too quickly. Try again in 1 hour.")
    expect(throttleMessage(7200)).toBe("You're doing that too quickly. Try again in 2 hours.")
  })

  it('never says zero, and never says NaN', async () => {
    const { throttleMessage } = await fresh()
    expect(throttleMessage(0)).toContain('1 second')
    expect(throttleMessage(-5)).toContain('1 second')
    expect(throttleMessage(0.2)).toContain('1 second')
  })
})

// ---------------------------------------------------------------------------
// The budget table itself
// ---------------------------------------------------------------------------

describe('the budget table', () => {
  it('is per class, not one global number', async () => {
    const mod = await fresh()
    const budgets = Object.entries(mod)
      .filter(([k]) => k.endsWith('_BUDGET'))
      .map(([k, v]) => [k, v as { scope: string; max: number; windowMs: number }] as const)

    expect(budgets.length).toBeGreaterThanOrEqual(15)

    const scopes = budgets.map(([, b]) => b.scope)
    expect(new Set(scopes).size).toBe(scopes.length)
    for (const s of scopes) expect(s.startsWith('act:')).toBe(true)

    for (const [, b] of budgets) {
      expect(b.max).toBeGreaterThan(0)
      expect(b.windowMs).toBeGreaterThan(0)
    }

    // The point of the exercise: the classes are genuinely different rates, so
    // a single global number could not have covered them.
    const perMinute = budgets.map(([, b]) => b.max / (b.windowMs / 60_000))
    expect(Math.max(...perMinute) / Math.min(...perMinute)).toBeGreaterThan(100)
  })

  it('holds the moderation queue tighter than the feed', async () => {
    const { REPORT_BUDGET, REACTION_BUDGET } = await fresh()
    const rate = (b: { max: number; windowMs: number }) => b.max / b.windowMs
    expect(rate(REPORT_BUDGET)).toBeLessThan(rate(REACTION_BUDGET))
  })
})

// ---------------------------------------------------------------------------
// End to end through two real actions
//
// No existing test imports a server-action module, so without these the wiring
// is only proven by tsc and the source guard. These two are chosen because they
// return DIFFERENT error shapes, which is the property that had to hold: a
// throttled call must look like every other refusal the action already makes,
// so no caller needs changing.
// ---------------------------------------------------------------------------

describe('call sites return the throttle in their own error shape', () => {
  const getUser = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    getUser.mockResolvedValue({ data: { user: { id: UID, email: 'a@b.co' } } })
    vi.doMock('@/lib/supabase/server', () => ({
      createClient: async () => ({ auth: { getUser }, from: vi.fn() }),
      getSessionUser: async () => ({ id: UID, email: 'a@b.co' }),
    }))
    vi.doMock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
    vi.doMock('@/lib/server/track', () => ({ trackServer: vi.fn() }))
    vi.doMock('@/lib/server/log', () => ({
      logError: vi.fn(), logWarn: vi.fn(), logInfo: vi.fn(),
    }))
  })

  it('submitReport returns { error } — the same field a bad reason returns', async () => {
    rpc.mockResolvedValue({ data: [{ allowed: false, retry_after: 300 }], error: null })
    const { submitReport } = await import('@/app/actions/reports')

    const res = await submitReport({ reportedUsername: 'someone', reason: 'spam' })

    expect(res).toEqual({ error: "You're doing that too quickly. Try again in 5 minutes." })
    // Refused BEFORE any database work: the profile lookup never ran.
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls[0][1].p_key).toBe(`act:report:u:${UID}`)
  })

  it('ackWelcome returns { ok: false, error } — its own discriminated shape', async () => {
    rpc.mockResolvedValue({ data: [{ allowed: false, retry_after: 45 }], error: null })
    const { ackWelcome } = await import('@/app/actions/welcome')

    const res = await ackWelcome('pro')

    expect(res).toEqual({
      ok: false,
      error: "You're doing that too quickly. Try again in 45 seconds.",
    })
    expect(serviceFrom).not.toHaveBeenCalled()
  })

  it('lets the action through, unchanged, when the budget has room', async () => {
    durableAllows()
    const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
    serviceFrom.mockReturnValue({ update })

    const { ackWelcome } = await import('@/app/actions/welcome')
    await expect(ackWelcome('pro')).resolves.toEqual({ ok: true })
    expect(update).toHaveBeenCalledWith({ welcome_tier_seen: 'pro' })
  })

  it('throttles after the auth check, so an anonymous caller still gets its own error', async () => {
    // Ordering matters: keying on a session id requires the session to have
    // been resolved first, and "Not authenticated." must not be replaced by a
    // throttle message.
    getUser.mockResolvedValue({ data: { user: null } })
    rpc.mockResolvedValue({ data: [{ allowed: false, retry_after: 300 }], error: null })

    const { submitReport } = await import('@/app/actions/reports')
    await expect(submitReport({ reportedUsername: 'x', reason: 'spam' }))
      .resolves.toEqual({ error: 'Not authenticated.' })
    expect(rpc).not.toHaveBeenCalled()
  })
})
