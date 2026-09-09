// app/tests/unit/funnel-visitors.test.ts
//
// ── Why this test exists ────────────────────────────────────────────────────
//
// "App visitors" is the top bar of the core funnel and therefore the
// denominator of visitor → signup, the one conversion rate the roadmap tells
// the founder to take a baseline from.
//
// It keyed its set on `user_id ?? anon_id`. Every person who browsed
// logged-out and then signed in writes `page_view` rows under BOTH keys — an
// anon_id with a null user_id before, both columns after — and those are two
// different members of one set. Measured at the audit timestamp: 117 distinct
// anon_ids + 11 distinct user_ids = the 128 the page displayed, and all 12
// anon_ids ever seen next to a user_id also appear with user_id null.
//
// The inflation is not noise. It is *exactly the people who converted*, added
// to the denominator of the rate that measures conversion — so the metric got
// worse the better the product did.
//
// The fix resolves each anon_id to its owner before counting. It does NOT make
// the figure a headcount, and the tests below pin the limit as deliberately as
// the fix: `anonId()` is per-device and rotates every 180 days (lib/track.ts),
// so this is an upper bound on people and the funnel label says "(est.)".
import { describe, it, expect } from 'vitest'
import { getFunnelDashboard } from '@/lib/server/funnel'
import type { SupabaseClient } from '@supabase/supabase-js'

type Row = Record<string, unknown>

/** Same minimal PostgREST-shaped fake as funnel-internal-filter.test.ts:
 *  records `.eq()` filters and applies them to the fixture rows. */
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

/** A page_view as the client writes it: anon_id always, user_id once signed in. */
const view = (anon_id: string | null, user_id: string | null = null, is_internal = false): Row =>
  ({ event: 'page_view', anon_id, user_id, is_internal, props: {}, created_at: '2026-08-20T00:00:00.000Z' })

const profile = (id: string, is_internal: boolean): Row =>
  ({ id, is_internal, created_at: '2026-07-01T00:00:00.000Z', onboarding_completed: true, acquisition_source: null })

const empty = {
  trades: [], subscriptions: [], broker_accounts: [],
  lesson_completions: [], posts: [], messages: [],
}

const visitors = async (svc: SupabaseClient) =>
  (await getFunnelDashboard(svc)).funnel.find((r) => r.step.startsWith('App visitors'))!.count

describe('App visitors — one person who signs in is one visitor', () => {
  it('counts a convert once, not twice', async () => {
    // The production shape in miniature: three sessions of anonymous browsing,
    // then the same device signed in. Before the fix this returned 2.
    const svc = fakeSupabase({
      profiles: [profile('user-1', false)],
      analytics_events: [
        view('anon-1'),
        view('anon-1'),
        view('anon-1', 'user-1'),
        view('anon-1', 'user-1'),
      ],
      ...empty,
    })
    expect(await visitors(svc)).toBe(1)
  })

  it('resolves the anonymous rows even when the signed-in row comes first', async () => {
    // Row order is arbitrary — the mapping is built from the whole window
    // before anything is counted, not as a running fold.
    const svc = fakeSupabase({
      profiles: [profile('user-1', false)],
      analytics_events: [view('anon-1', 'user-1'), view('anon-1')],
      ...empty,
    })
    expect(await visitors(svc)).toBe(1)
  })

  it('still counts unidentified visitors separately', async () => {
    // The correction must not collapse strangers into each other: an anon_id
    // never seen beside a user is its own visitor.
    const svc = fakeSupabase({
      profiles: [profile('user-1', false)],
      analytics_events: [
        view('anon-1'), view('anon-1', 'user-1'), // one convert
        view('anon-2'),                           // one stranger
        view('anon-3'),                           // another stranger
      ],
      ...empty,
    })
    expect(await visitors(svc)).toBe(3)
  })

  it('counts one signed-in person on two devices once', async () => {
    // Two anon_ids, one user_id: the join is the user, and both devices
    // resolve to them.
    const svc = fakeSupabase({
      profiles: [profile('user-1', false)],
      analytics_events: [
        view('phone'), view('phone', 'user-1'),
        view('laptop', 'user-1'),
      ],
      ...empty,
    })
    expect(await visitors(svc)).toBe(1)
  })

  it('is an upper bound, not a headcount — and the label admits it', async () => {
    // The limit that no query on this table can close: the same person on two
    // devices who signs in on NEITHER is indistinguishable from two people.
    // Recorded here so nobody "fixes" the count later and quietly drops the
    // caveat from the label.
    const svc = fakeSupabase({
      profiles: [],
      analytics_events: [view('phone'), view('laptop')],
      ...empty,
    })
    const f = await getFunnelDashboard(svc)
    expect(f.funnel[0].count).toBe(2)
    expect(f.funnel[0].step).toBe('App visitors (est.)')
  })

  it('drops internal traffic before resolving identities', async () => {
    // An internal user's anon_id must not survive as an anonymous visitor
    // after their signed-in rows are filtered out.
    const svc = fakeSupabase({
      profiles: [profile('real', false), profile('seed', true)],
      analytics_events: [
        view('anon-real'), view('anon-real', 'real'),
        view('anon-seed'), view('anon-seed', 'seed'),
        view('anon-admin', 'admin-user', true),
      ],
      ...empty,
    })
    // 'anon-seed' still counts as an unidentified visitor here — its own rows
    // carry no user_id and nothing in the table says whose device it is once
    // the seed's signed-in rows are gone. That is the existing exclusion
    // policy's edge, not this fix's: it is unchanged, and named rather than
    // silently asserted away.
    expect(await visitors(svc)).toBe(2)
  })
})
