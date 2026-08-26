import { describe, it, expect } from 'vitest'
import { getFunnelDashboard } from '@/lib/server/funnel'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * ── Why this test exists ────────────────────────────────────────────────────
 *
 * `analytics_events.is_internal` is a COPY of `profiles.is_internal`, taken at
 * the moment the event is written. Seed and demo accounts were flagged internal
 * AFTER they had generated events, so those rows are stamped `false` forever
 * and re-flagging the profile does not touch them.
 *
 * Measured in production on 2026-08-26: 1,115 such events across 91 users.
 * All of them were written 2026-07-16..07-20, and the dashboard is scoped to
 * 30 days, so they fall outside the window and it currently reads correctly.
 * The defect is LATENT — another seed run, or the 3-hourly demo activity
 * routine, puts stale-stamped events inside the window and the funnel inflates
 * silently on the page the roadmap uses for baselines.
 *
 * The stamped column is still consulted, because a stamped `true` is never
 * wrong and catches something profiles cannot: trackServer marks admin traffic
 * internal by email allowlist, and an admin's profile is not necessarily
 * flagged. So both tests must be applied, and this file pins both directions.
 */

type Row = Record<string, unknown>

/** Minimal PostgREST-shaped fake: records `.eq()` filters and applies them to
 *  the table's fixture rows. Other builder methods are no-ops — this exercises
 *  membership, not query planning. */
function fakeSupabase(tables: Record<string, Row[]>): SupabaseClient {
  const make = (table: string) => {
    const eqs: [string, unknown][] = []
    const builder: Record<string, unknown> = {}
    const self = () => builder
    for (const m of ['select', 'neq', 'not', 'in', 'gte', 'order', 'limit']) builder[m] = self
    builder.eq = (col: string, val: unknown) => { eqs.push([col, val]); return builder }
    builder.then = (resolve: (v: unknown) => unknown) => {
      const rows = (tables[table] ?? []).filter((r) =>
        eqs.every(([c, v]) => r[c] === v))
      return Promise.resolve({ data: rows, error: null, count: rows.length }).then(resolve)
    }
    return builder
  }
  return { from: (t: string) => make(t) } as unknown as SupabaseClient
}

const ev = (event: string, user_id: string | null, is_internal = false): Row =>
  ({ event, user_id, is_internal, anon_id: null, props: {}, created_at: '2026-08-20T00:00:00.000Z' })

const profile = (id: string, is_internal: boolean): Row =>
  ({ id, is_internal, created_at: '2026-07-01T00:00:00.000Z', onboarding_completed: true, acquisition_source: null })

describe('getFunnelDashboard — internal traffic is judged by profiles, not the stamp', () => {
  it('excludes a stale-stamped event whose user is internal now', async () => {
    // `seed` is the production bug in one row: the event says false, the
    // profile says true, and the profile is right.
    const svc = fakeSupabase({
      profiles: [profile('real', false), profile('seed', true)],
      analytics_events: [
        ev('signup_completed', 'real'),
        ev('signup_completed', 'seed'),
      ],
      trades: [], subscriptions: [], broker_accounts: [],
      lesson_completions: [], posts: [], messages: [],
    })
    const f = await getFunnelDashboard(svc)
    const signups = f.funnel.find((r) => r.step === 'Signups completed')!.count
    expect(signups).toBe(1)
  })

  it('still excludes admin traffic, which only the stamp knows about', async () => {
    // trackServer stamps admins internal by email allowlist; their profile row
    // is not necessarily flagged. Dropping the column filter in favour of the
    // profiles join alone would silently start counting admin sessions.
    const svc = fakeSupabase({
      profiles: [profile('real', false), profile('admin', false)],
      analytics_events: [
        ev('signup_completed', 'real'),
        ev('signup_completed', 'admin', true),
      ],
      trades: [], subscriptions: [], broker_accounts: [],
      lesson_completions: [], posts: [], messages: [],
    })
    const f = await getFunnelDashboard(svc)
    expect(f.funnel.find((r) => r.step === 'Signups completed')!.count).toBe(1)
  })

  it('keeps anonymous events, which belong to no profile', async () => {
    const svc = fakeSupabase({
      profiles: [profile('real', false)],
      analytics_events: [ev('not_found', null), ev('not_found', 'real')],
      trades: [], subscriptions: [], broker_accounts: [],
      lesson_completions: [], posts: [], messages: [],
    })
    const f = await getFunnelDashboard(svc)
    expect(f.notFound30d).toBe(2)
  })

  it('applies the same rule to the broker funnel', async () => {
    const svc = fakeSupabase({
      profiles: [profile('real', false), profile('seed', true)],
      analytics_events: [
        ev('broker_card_viewed', 'real'),
        ev('broker_card_viewed', 'seed'),
        ev('broker_connected', 'seed'),
      ],
      trades: [], subscriptions: [], broker_accounts: [],
      lesson_completions: [], posts: [], messages: [],
    })
    const f = await getFunnelDashboard(svc)
    expect(f.brokerFunnel.find((r) => r.step === 'Broker card viewed')!.count).toBe(1)
    // A seed account must never be able to report the differentiator working.
    expect(f.brokerFunnel.find((r) => r.step === 'Broker connected')!.count).toBe(0)
  })
})
