// app/tests/unit/rules-gate.test.ts
//
// Guards the server-side tier check on saveTradingRules.
//
// The trading-rules card is gated at Trader+ in the UI: journal/page.tsx asks
// canFlag(flags, tier, 'trading_rules') and simply does not render RulesCard
// for a Free account. The action behind it did no such check, and a server
// action is a plain POST endpoint — a Free account that hand-built the request
// wrote trading_rules and got the feature. Every other gated write in the
// codebase re-checks on the server (trade.ts, profile.ts, mt5-import.ts,
// broker.ts, templates.ts, social.ts, cover.ts, exchange.ts); this was the one
// that did not.
//
// Nothing fails when the check is missing: the upsert succeeds, the form says
// Saved, and the row is real. It is found by reading the action against the
// page that renders it, or not at all.
//
// Mocking style follows tests/unit/trade-visibility.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { requiredPlanLabel, type Tier } from '@/lib/entitlements'

const UID = '11111111-2222-4333-8444-555555555555'

// --- the edges -------------------------------------------------------------

/** The tier getTier will report. Set per test before importing the action. */
let TIER: Tier = 'free'
const upserted = vi.fn<(p: Record<string, unknown>) => void>()

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: UID, email: 'a@b.co' } } }) },
    from: () => ({
      upsert: async (payload: Record<string, unknown>) => {
        upserted(payload)
        return { error: null }
      },
    }),
  }),
}))

vi.mock('@/lib/server/action-throttle', () => ({
  allowAction: async () => ({ ok: true }),
  JOURNAL_BUDGET: { scope: 'act:journal', max: 60, windowMs: 600_000 },
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/server/entitlements', () => ({ getTier: async () => TIER }))
// No rows in feature_flags, so canFlag falls back to the static FEATURE_MIN_TIER
// map — the same fallback production runs with until someone adds an override.
vi.mock('@/lib/server/feature-flags', () => ({ getFeatureFlags: async () => ({}) }))

/** A filled-in rules form: the exact body the card posts. */
function form(): FormData {
  const fd = new FormData()
  fd.set('max_trades_per_day', '2')
  fd.set('min_rr', '2')
  fd.set('max_risk_percent', '1')
  fd.set('require_stop', 'on')
  fd.set('session', 'london')
  fd.set('no_trade_after_losses', '2')
  return fd
}

async function save() {
  const mod = await import('@/app/actions/rules')
  return mod.saveTradingRules({}, form())
}

beforeEach(() => {
  upserted.mockClear()
  vi.resetModules()
})

describe('saveTradingRules', () => {
  it('refuses a Free caller and writes nothing', async () => {
    TIER = 'free'
    const res = await save()
    expect(res.ok).toBeUndefined()
    expect(res.error).toBeTruthy()
    // The refusal has to happen BEFORE the upsert, not merely be reported after
    // it. A gate that returns an error while the row still lands is no gate.
    expect(upserted).not.toHaveBeenCalled()
  })

  it('names the plan the gate actually enforces', async () => {
    TIER = 'free'
    const res = await save()
    // Derived, not hardcoded: plan-labels.test.ts pins requiredPlanLabel to
    // FEATURE_MIN_TIER, so this asserts the copy tracks the gate. Writing
    // 'Trader' here instead would let the two drift the moment the tier moves,
    // which is the bug plan-labels.test.ts exists to prevent.
    expect(res.error).toContain(requiredPlanLabel('trading_rules'))
  })

  it('lets a Trader caller through and saves the row', async () => {
    TIER = 'trader'
    const res = await save()
    expect(res.error).toBeUndefined()
    expect(res.ok).toBe(true)
    expect(upserted).toHaveBeenCalledTimes(1)
    expect(upserted.mock.calls[0][0]).toMatchObject({
      user_id: UID,
      max_trades_per_day: 2,
      min_rr: 2,
      max_risk_percent: 1,
      require_stop: true,
      session: 'london',
      no_trade_after_losses: 2,
    })
  })

  it('lets a Pro caller through — the gate is a floor, not an equality', async () => {
    TIER = 'pro'
    const res = await save()
    expect(res.ok).toBe(true)
    expect(upserted).toHaveBeenCalledTimes(1)
  })
})

describe('the rules card', () => {
  it('renders the error the action returns', async () => {
    // A returned { error } is only an improvement if the caller reads it
    // (CLAUDE.md). RulesCard drives the form with useActionState, so the
    // refusal has to reach the user somewhere in the JSX.
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(
      join(process.cwd(), 'src', 'app', 'journal', '_components', 'RulesCard.tsx'),
      'utf8',
    )
    expect(src).toContain('useActionState')
    expect(src).toContain('state.error')
  })
})
