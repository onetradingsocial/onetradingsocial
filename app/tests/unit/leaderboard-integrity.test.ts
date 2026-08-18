import { describe, it, expect } from 'vitest'
import { boardEligibleIds } from '@/lib/feature-flags'
import { parseAccountBalance, MAX_ACCOUNT_BALANCE } from '@/lib/trade'
import { cohortOf, groupByCohort, COHORT_ORDER, type RankedEntry } from '@/lib/server/ranking'
import type { Tier } from '@/lib/entitlements'

/**
 * Audit item 15, WS5. Each block below pins one finding's fix so that undoing
 * it fails loudly rather than quietly restoring the exploit.
 */

// ── F6 · internal/seed accounts, and the fail-open tier gate ─────────────────

describe('boardEligibleIds (item 15 F6)', () => {
  const tiers = (m: Record<string, Tier>) => new Map(Object.entries(m))
  const NONE = new Set<string>()

  it('drops free accounts and keeps paid ones', () => {
    const out = boardEligibleIds(['free1', 'trader1', 'pro1'], tiers({
      free1: 'free', trader1: 'trader', pro1: 'pro',
    }), {}, NONE)
    expect(out).toEqual(['trader1', 'pro1'])
  })

  it('EXCLUDES internal/seed accounts however good their tier', () => {
    // The live shape of the problem: 420 of 457 production profiles are
    // is_internal, all public, all onboarded, none opted out. They were absent
    // from the board only because none held a subscription.
    const out = boardEligibleIds(['seed', 'real'], tiers({ seed: 'pro', real: 'trader' }), {},
      new Set(['seed']))
    expect(out).toEqual(['real'])
  })

  it('FAILS CLOSED on an unknown tier', () => {
    // getTierMap returns an EMPTY map on any read error, so "unknown" is what
    // a transient Supabase failure looks like for every candidate at once.
    // Treating it as eligible published seeded personas on one bad read.
    expect(boardEligibleIds(['a', 'b'], new Map(), {}, NONE)).toEqual([])
    expect(boardEligibleIds(['a', 'b'], tiers({ a: 'pro' }), {}, NONE)).toEqual(['a'])
  })

  it('respects a feature-flag override that opens ranking to free', () => {
    const flags = { leaderboard_ranking: { free: true, trader: true, pro: true } }
    expect(boardEligibleIds(['f'], tiers({ f: 'free' }), flags, NONE)).toEqual(['f'])
    // ...but the internal exclusion is not a flag and cannot be opened by one.
    expect(boardEligibleIds(['f'], tiers({ f: 'free' }), flags, new Set(['f']))).toEqual([])
  })

  it('de-duplicates ids', () => {
    expect(boardEligibleIds(['a', 'a'], tiers({ a: 'pro' }), {}, NONE)).toEqual(['a'])
  })
})

// ── F3 · the account-balance bound ──────────────────────────────────────────

describe('parseAccountBalance (item 15 F3)', () => {
  it('accepts an ordinary balance and rounds to cents', () => {
    expect(parseAccountBalance('10000')).toEqual({ balance: 10000 })
    expect(parseAccountBalance(1234.567)).toEqual({ balance: 1234.57 })
    expect(parseAccountBalance(0)).toEqual({ balance: 0 })
  })

  it('accepts the bound exactly and refuses one above it', () => {
    expect(parseAccountBalance(MAX_ACCOUNT_BALANCE)).toEqual({ balance: MAX_ACCOUNT_BALANCE })
    expect(parseAccountBalance(MAX_ACCOUNT_BALANCE + 1)).toHaveProperty('error')
  })

  it('refuses the 1000x inflation the old code accepted', () => {
    expect(parseAccountBalance(10_000_000_000)).toHaveProperty('error')
  })

  it('refuses rather than silently coercing to zero', () => {
    // The old code was `Number.isFinite(n) && n >= 0 ? n : 0`, so a typo wrote
    // 0 — and, with the retroactive rescale attached, zeroed every money P&L
    // the user had ever logged.
    expect(parseAccountBalance('abc')).toHaveProperty('error')
    expect(parseAccountBalance('')).toHaveProperty('error') // Number('') is 0, but '' is not a balance
    expect(parseAccountBalance(-1)).toHaveProperty('error')
    expect(parseAccountBalance(Infinity)).toHaveProperty('error')
    expect(parseAccountBalance(NaN)).toHaveProperty('error')
  })

  it('keeps the pnl_amount CHECK from 0045 reachable, not contradicted', () => {
    // balance x max r_multiple must stay inside trades_pnl_amount_bounded,
    // or a saveable balance could make closing a trade fail with a 23514.
    expect(MAX_ACCOUNT_BALANCE * 1000).toBeLessThanOrEqual(1e12)
  })
})

// ── F5 · verified and self-reported are ranked separately ───────────────────

describe('rank cohorts (item 15 F5)', () => {
  const entry = (userId: string, level: RankedEntry['verification'], pnl: number): RankedEntry => ({
    rank: 1, cohort: cohortOf(level), userId, username: userId, displayName: null, avatarUrl: null,
    pnl, winRate: 1, avgR: 1, trades: 1, expectancy: 1, profitFactor: 1, maxDrawdownR: 0,
    consistency: 1, riskAdjusted: 1, verification: level, accountType: null,
  })

  it('maps every verification level onto a cohort', () => {
    expect(cohortOf('broker_connected')).toBe('broker_connected')
    expect(cohortOf('statement_imported')).toBe('statement_imported')
    expect(cohortOf('self_reported')).toBe('self_reported')
    // pending/failed are not evidence, so they rank with self-reported.
    expect(cohortOf('verification_pending')).toBe('self_reported')
    expect(cohortOf('verification_failed')).toBe('self_reported')
  })

  it('orders cohorts strongest evidence first', () => {
    expect([...COHORT_ORDER]).toEqual(['broker_connected', 'statement_imported', 'self_reported'])
  })

  it('never puts a self-reported trader in the same group as a broker-synced one', () => {
    // This is the /verification claim, as a test: "Manual trades never appear
    // equivalent to broker-synced trades anywhere on TradingSocial."
    const groups = groupByCohort([
      entry('fabricator', 'self_reported', 9_999_999),
      entry('honest', 'broker_connected', 100),
    ])
    expect(groups.map((g) => g.cohort)).toEqual(['broker_connected', 'self_reported'])
    expect(groups[0].rows.map((r) => r.userId)).toEqual(['honest'])
    expect(groups[1].rows.map((r) => r.userId)).toEqual(['fabricator'])
    // The huge self-reported P&L does not reach the top group at all, which is
    // the property a single sorted list could not give.
    expect(groups[0].rows.some((r) => r.pnl === 9_999_999)).toBe(false)
  })

  it('drops empty cohorts so the board does not render three empty headings', () => {
    const groups = groupByCohort([entry('only', 'self_reported', 10)])
    expect(groups).toHaveLength(1)
    expect(groups[0].cohort).toBe('self_reported')
  })

  it('returns nothing for an empty board', () => {
    expect(groupByCohort([])).toEqual([])
  })
})
