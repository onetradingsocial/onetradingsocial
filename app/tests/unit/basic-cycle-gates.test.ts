// app/tests/unit/basic-cycle-gates.test.ts
//
// The two tier boundaries the "Basic Cycle" change moves, and the one it must
// NOT move.
//
// The principle being encoded: free gets the INPUTS to reflection, paid gets
// the ANALYSIS of performance. That resolves three judgement calls that look
// identical from a distance and are not:
//
//   mistake_tagging   free     — writing "revenge trade" on a close you just made
//   mistake_analysis  trader   — the card that scores those tags against results
//   strategy_tracking trader   — which setup pays; analysis, and it does not move
//
// and one cap:
//
//   multiple_goals    trader   — Free holds FREE_ACTIVE_GOAL_LIMIT active goals
//
// The failure mode for all of it is silence. A gate on the wrong key does not
// throw, does not fail to compile, and does not show up in a diff review as
// anything other than a plausible identifier: `mistake_tagging` and
// `mistake_analysis` are one word apart, and the card that reads the second one
// used to read the first.
//
// Mocking style follows tests/unit/rules-gate.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  can, FEATURE_MIN_TIER, FREE_ACTIVE_GOAL_LIMIT, requiredPlanLabel, type Tier,
} from '@/lib/entitlements'
import { defaultMatrix } from '@/lib/feature-flags'
import { GOAL_LIMIT_ERROR } from '@/lib/goals'

const UID = '11111111-2222-4333-8444-555555555555'
const src = (...parts: string[]) => readFileSync(join(process.cwd(), 'src', ...parts), 'utf8')

// ---------------------------------------------------------------------------
// 1. The matrix itself
// ---------------------------------------------------------------------------

describe('the free/paid line', () => {
  it('gives Free the reflection inputs', () => {
    expect(can('free', 'mistake_tagging')).toBe(true)
  })

  it('keeps the analysis of those inputs paid', () => {
    // Both halves matter. If mistake_analysis ever became free, the whole
    // reason for splitting the key would be gone and the card would ship with
    // the tag.
    expect(can('free', 'mistake_analysis')).toBe(false)
    expect(can('trader', 'mistake_analysis')).toBe(true)
  })

  it('does not move strategy tracking', () => {
    // The change most likely to be made "while we are in here". Strategy tags
    // exist so the product can say which setup pays — that is analysis, it is
    // what Trader is sold on, and it stays at Trader with Pro's eight tags.
    expect(FEATURE_MIN_TIER.strategy_tracking).toBe('trader')
    expect(can('free', 'strategy_tracking')).toBe(false)
  })

  it('caps Free at one active goal and sells the rest', () => {
    expect(FREE_ACTIVE_GOAL_LIMIT).toBe(1)
    expect(can('free', 'multiple_goals')).toBe(false)
    expect(can('trader', 'multiple_goals')).toBe(true)
  })

  it('the migration and the constant describe the same row', () => {
    // canFlag lets a feature_flags row override FEATURE_MIN_TIER outright, so
    // the constant below is inert in production until 0071 runs. This pins the
    // two together: if someone edits the matrix back, or edits the migration to
    // a different shape, one of these fails.
    const sql = readFileSync(
      join(process.cwd(), 'supabase', 'migrations', '0071_mistake_tagging_free.sql'), 'utf8',
    )
    expect(defaultMatrix('mistake_tagging')).toEqual({ free: true, trader: true, pro: true })
    expect(sql).toMatch(/update public\.feature_flags\s+set free = true\s+where feature = 'mistake_tagging'/)
    // And it must not quietly take strategy_tracking with it — they are
    // adjacent lines in the 0015 seed.
    expect(sql).not.toMatch(/^\s*(update|insert)[\s\S]*'strategy_tracking'/m)
  })
})

// ---------------------------------------------------------------------------
// 2. The goal cap, server-side
// ---------------------------------------------------------------------------

/** The tier getTier reports, and how many active goals the account holds. */
let TIER: Tier = 'free'
let ACTIVE_GOALS = 0
const inserted = vi.fn<(p: Record<string, unknown>) => void>()
const deleted = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: UID, email: 'a@b.co' } } }) },
    from: () => ({
      insert: async (payload: Record<string, unknown>) => {
        inserted(payload)
        return { error: null }
      },
      // The count query: .select(_, { head: true }).eq().eq() resolves to
      // { count, error }, so every .eq() has to be thenable as well as chainable.
      select: () => {
        const chain = {
          eq: () => chain,
          then: (resolve: (v: { count: number; error: null }) => void) =>
            resolve({ count: ACTIVE_GOALS, error: null }),
        }
        return chain
      },
      delete: () => {
        const chain = {
          eq: () => chain,
          then: (resolve: (v: { error: null }) => void) => { deleted(); resolve({ error: null }) },
        }
        return chain
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
// No override rows, so canFlag falls through to FEATURE_MIN_TIER — the state
// production runs in for `multiple_goals`, which 0071 deliberately does not seed.
vi.mock('@/lib/server/feature-flags', () => ({ getFeatureFlags: async () => ({}) }))

async function add() {
  const mod = await import('@/app/actions/goals')
  return mod.addGoal({ kind: 'journal_consistency', target: 80, windowDays: 30 })
}

beforeEach(() => {
  inserted.mockClear()
  deleted.mockClear()
  vi.resetModules()
})

describe('addGoal', () => {
  it('lets a Free account set its first goal', async () => {
    TIER = 'free'; ACTIVE_GOALS = 0
    const res = await add()
    expect(res.ok).toBe(true)
    expect(inserted).toHaveBeenCalledTimes(1)
    expect(inserted.mock.calls[0][0]).toMatchObject({ user_id: UID, kind: 'journal_consistency', target: 80 })
  })

  it('refuses the second one, and writes nothing', async () => {
    TIER = 'free'; ACTIVE_GOALS = FREE_ACTIVE_GOAL_LIMIT
    const res = await add()
    expect(res.ok).toBeUndefined()
    expect(res.error).toBe(GOAL_LIMIT_ERROR)
    // Refused BEFORE the insert. A gate that reports an error while the row
    // still lands is no gate.
    expect(inserted).not.toHaveBeenCalled()
  })

  it('names the plan the gate actually enforces', async () => {
    TIER = 'free'; ACTIVE_GOALS = 3
    const res = await add()
    expect(res.error).toContain(requiredPlanLabel('multiple_goals'))
  })

  it('never deletes or deactivates the goals an over-cap account already holds', async () => {
    // The precedent is keepThenCap in actions/trade.ts: a cap limits ADDING and
    // must not eat data recorded before it existed. Goals shipped uncapped, so
    // Free accounts are sitting on two and three of them right now.
    TIER = 'free'; ACTIVE_GOALS = 4
    const res = await add()
    expect(res.error).toBeTruthy()
    expect(deleted).not.toHaveBeenCalled()
    expect(inserted).not.toHaveBeenCalled()
    // And the refusal has to say so — an account over the cap that is told only
    // "upgrade" has no way to know its four goals are still being tracked.
    expect(res.error).toMatch(/stays exactly as it is/)
  })

  it('lets a Trader past the cap entirely', async () => {
    TIER = 'trader'; ACTIVE_GOALS = 7
    const res = await add()
    expect(res.ok).toBe(true)
    expect(inserted).toHaveBeenCalledTimes(1)
  })

  it('lets a Pro through — the gate is a floor, not an equality', async () => {
    TIER = 'pro'; ACTIVE_GOALS = 7
    const res = await add()
    expect(res.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 3. The call sites, read against the keys
// ---------------------------------------------------------------------------

describe('the journal page', () => {
  const PAGE = src('app', 'journal', 'page.tsx')

  it('gates the mistake ANALYSIS card on mistake_analysis, not on the tag', () => {
    // The card and the tag write shared one key before this change. Keyed on
    // mistake_tagging the card now renders for every Free account, giving away
    // the per-tag win rate and average R that Trader is sold on — and no test,
    // type or build notices.
    const at = PAGE.indexOf('MistakeAnalysisCard trades=')
    expect(at, 'MistakeAnalysisCard is not rendered in journal/page.tsx').toBeGreaterThan(-1)
    const guard = PAGE.slice(Math.max(0, at - 200), at)
    expect(guard).toContain('canMistakeAnalysis')
    expect(PAGE).toContain(`canFlag(flags, tier, 'mistake_analysis')`)
  })

  it('still gates the tag chips on mistake_tagging', () => {
    // The other side of the split: RecentTrades opens CloseTradeModal, which is
    // where a tag is written. It must read the free key or the change does
    // nothing a user can see.
    expect(PAGE).toContain(`canMistakeTag={canFlag(flags, tier, 'mistake_tagging')}`)
  })

  it('passes the goal entitlement down instead of letting the card guess', () => {
    expect(PAGE).toContain(`canMultiple={canFlag(flags, tier, 'multiple_goals')}`)
  })
})

describe('closeTrade', () => {
  it('gates the mistake-tag write on mistake_tagging and nothing else', () => {
    // Deliberately still gated: a feature_flags row can revoke a free feature,
    // and an admin needs that lever. It simply passes for every tier now.
    const TRADE = src('app', 'actions', 'trade.ts')
    expect(TRADE).toContain(`'mistake_tagging')`)
    expect(TRADE).not.toContain(`'mistake_analysis')`)
  })
})

describe('GoalsCard', () => {
  const CARD = src('app', 'journal', '_components', 'GoalsCard.tsx')

  it('awaits the action inside the transition and reads its error', () => {
    // CLAUDE.md: a synchronous transition callback closes before the action
    // settles, so the write can silently fail to land — and a returned
    // { error } is only an improvement if the caller reads it.
    expect(CARD).toMatch(/start\(async \(\) => \{[\s\S]{0,240}await addGoal/)
    expect(CARD).toContain('r.error')
  })

  it('renders one copy of the limit message, from the shared constant', () => {
    // The card explains the cap before the round trip and the action returns it
    // after; two hand-written versions would drift, and only one of them is
    // derived from FEATURE_MIN_TIER.
    expect(CARD).toContain('GOAL_LIMIT_ERROR')
    expect(CARD).not.toMatch(/Free keeps \d/)
  })

  it('withholds Add at the cap without hiding the goals already stored', () => {
    // The goals map is unconditional; only the Add control keys on the cap.
    expect(CARD).toContain('atLimit')
    expect(CARD).not.toMatch(/atLimit[\s\S]{0,80}goals\.map/)
    expect(CARD).toMatch(/\{goals\.map\(/)
  })
})
