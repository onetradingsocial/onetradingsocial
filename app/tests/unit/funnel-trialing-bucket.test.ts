import { describe, it, expect } from 'vitest'
import { getFunnelDashboard } from '@/lib/server/funnel'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * ── Why this test exists ────────────────────────────────────────────────────
 *
 * 'Paid' used to count `['active', 'trialing']` as one figure. That was
 * harmless while the only Stripe trial was the rare referral reward.
 *
 * It stops being harmless the moment every signup opens a trialing
 * subscription: 'Paid' would then count the entire user base from day 0, the
 * number would go UP, and it would look like the product had started working.
 * A metric that silently inflates is far harder to catch than one that zeroes,
 * because nobody investigates good news — so this pins the split rather than
 * leaving it to be noticed in a baseline six weeks later.
 */

type Row = Record<string, unknown>

/** Same minimal PostgREST-shaped fake as funnel-internal-filter.test.ts.
 *  `.in()` is a no-op, so the status filtering under test happens where the
 *  production code does it — in JS, over whatever rows come back. */
function fakeSupabase(tables: Record<string, Row[]>): SupabaseClient {
  const make = (table: string) => {
    const eqs: [string, unknown][] = []
    const builder: Record<string, unknown> = {}
    const self = () => builder
    for (const m of ['select', 'neq', 'not', 'in', 'gte', 'order', 'limit']) builder[m] = self
    builder.eq = (col: string, val: unknown) => { eqs.push([col, val]); return builder }
    builder.then = (resolve: (v: unknown) => unknown) => {
      const rows = (tables[table] ?? []).filter((r) => eqs.every(([c, v]) => r[c] === v))
      return Promise.resolve({ data: rows, error: null, count: rows.length }).then(resolve)
    }
    return builder
  }
  return { from: (t: string) => make(t) } as unknown as SupabaseClient
}

const profile = (id: string, is_internal = false): Row =>
  ({ id, is_internal, created_at: '2026-07-01T00:00:00.000Z', onboarding_completed: true, acquisition_source: null })

const sub = (user_id: string, status: string): Row => ({ user_id, status })

const build = (profiles: Row[], subscriptions: Row[]) => fakeSupabase({
  profiles, subscriptions,
  analytics_events: [], trades: [], broker_accounts: [],
  lesson_completions: [], posts: [], messages: [],
})

const bucket = (f: Awaited<ReturnType<typeof getFunnelDashboard>>, status: string) =>
  f.lifecycle.find((r) => r.status === status)?.count

describe('lifecycle: Paid and Trialing are separate figures', () => {
  it('a trialist counts as Trialing and NOT as Paid', async () => {
    const f = await getFunnelDashboard(build(
      [profile('t1'), profile('t2')],
      [sub('t1', 'trialing'), sub('t2', 'trialing')],
    ))
    expect(bucket(f, 'Trialing')).toBe(2)
    expect(bucket(f, 'Paid')).toBe(0)
  })

  it('a paying user counts as Paid and NOT as Trialing', async () => {
    const f = await getFunnelDashboard(build([profile('p1')], [sub('p1', 'active')]))
    expect(bucket(f, 'Paid')).toBe(1)
    expect(bucket(f, 'Trialing')).toBe(0)
  })

  it('a user holding BOTH is counted once, as Paid', async () => {
    // Upgrading onto a new subscription mid-trial leaves two live rows. The
    // buckets have to stay disjoint or the lifecycle table stops adding up.
    const f = await getFunnelDashboard(build(
      [profile('u1')],
      [sub('u1', 'trialing'), sub('u1', 'active')],
    ))
    expect(bucket(f, 'Paid')).toBe(1)
    expect(bucket(f, 'Trialing')).toBe(0)
  })

  it('neither bucket counts a dead or dunning subscription', async () => {
    // past_due is in NEITHER, deliberately: after a failed trial conversion it
    // is also the status of someone who has never paid a cent.
    const f = await getFunnelDashboard(build(
      [profile('a'), profile('b'), profile('c'), profile('d')],
      [sub('a', 'past_due'), sub('b', 'canceled'), sub('c', 'unpaid'), sub('d', 'incomplete')],
    ))
    expect(bucket(f, 'Paid')).toBe(0)
    expect(bucket(f, 'Trialing')).toBe(0)
  })

  it('internal accounts inflate neither bucket', async () => {
    // subscriptions is queried unfiltered by profile, so the is_internal rule
    // every other figure honours has to be applied to both buckets, not just
    // the one it was originally written for.
    const f = await getFunnelDashboard(build(
      [profile('real'), profile('seed', true)],
      [sub('real', 'trialing'), sub('seed', 'trialing'), sub('seed', 'active')],
    ))
    expect(bucket(f, 'Trialing')).toBe(1)
    expect(bucket(f, 'Paid')).toBe(0)
  })

  it('still reports both rows when there is nothing to count', async () => {
    // The row has to exist at zero. A bucket that vanishes when empty reads as
    // "not measured" rather than "measured, none".
    const f = await getFunnelDashboard(build([profile('x')], []))
    expect(bucket(f, 'Trialing')).toBe(0)
    expect(bucket(f, 'Paid')).toBe(0)
  })
})
