import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RetentionCell, pct } from '@/app/admin/cohorts/RetentionCell'
import { getCohortDashboard, type CohortRow } from '@/lib/server/cohorts'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * ── Why this test exists ────────────────────────────────────────────────────
 *
 * `/admin/cohorts` rendered every unmeasurable cell as `0% (0)`. A cohort that
 * signed up three days ago has not reached day 30, so its day-30 retention is
 * not zero — it is unknown. The table showed the two as the same number, which
 * reads as a measured failure and is the worse of the two errors: it invites
 * the founder to react to a retention cliff that has not happened yet.
 *
 * The audit that raised this assumed the fix would move the numbers. It does
 * not. A read-only re-derivation of the whole table in SQL confirmed the zeros
 * are TRUE — D7 and D30 are 0 for every cohort including ones well past 30
 * days, because 54 of 64 non-internal profiles have no activity of any kind.
 * The retention predicate is sound and is untouched. This is a rendering fix,
 * and the assertions below pin that: a mature zero must still render `0%`.
 *
 * The mechanism is a third state. `d1Due/d7Due/d30Due` count the group members
 * who have actually reached day N, so `due === 0` separates "not yet
 * measurable" from "measured, nobody returned". The percentage stays
 * retained/size and never becomes retained/due — switching the denominator
 * would move every published number, which is a different decision.
 */

type Row = Record<string, unknown>

/** Minimal PostgREST-shaped fake, same shape as funnel-internal-filter.test.ts:
 *  records `.eq()` filters and applies them to the table's fixture rows. Other
 *  builder methods are no-ops — this exercises the maturity arithmetic, not
 *  query planning. */
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

const NOW = new Date('2026-09-09T00:00:00.000Z')

const profile = (id: string, created_at: string, acquisition_source: string): Row => ({
  id, created_at, acquisition_source, is_internal: false,
  account_type: 'retail', main_markets: ['fx'],
})

/**
 * Four profiles chosen to put every maturity state on the board at once,
 * against a fixed `now` of 2026-09-09:
 *
 *  veteran  2026-06-01  100 days old, HAS activity  → mature, retained
 *  pA       2026-08-10   30 days old exactly        → day 30 has just arrived
 *  pB       2026-08-14   26 days old                → day 30 has NOT arrived
 *  newbie   2026-09-08   half a day old             → no day has arrived
 *
 * pA and pB share a signup week (Monday 2026-08-10), which is what makes the
 * cohort row partially mature — the case that must keep its number.
 */
const TABLES: Record<string, Row[]> = {
  profiles: [
    profile('veteran', '2026-06-01T00:00:00.000Z', 'organic'),
    profile('pA', '2026-08-10T00:00:00.000Z', 'organic'),
    profile('pB', '2026-08-14T00:00:00.000Z', 'organic'),
    profile('newbie', '2026-09-08T12:00:00.000Z', 'tiktok'),
  ],
  // Only the veteran ever came back — 44 days after signing up, so it counts
  // for day 1, day 7 and day 30 alike.
  trades: [{ user_id: 'veteran', created_at: '2026-07-15T00:00:00.000Z' }],
  posts: [], comments: [], likes: [], lesson_completions: [],
  analytics_events: [
    { user_id: 'veteran', device: 'desktop', event: 'page_view', created_at: '2026-06-01T01:00:00.000Z' },
  ],
}

const dash = () => getCohortDashboard(fakeSupabase(TABLES), NOW)
// Typed as CohortRow on purpose: if the maturity fields ever leave the exported
// type, this file stops compiling rather than quietly asserting on `undefined`.
const cohort = (rows: CohortRow[], week: string): CohortRow => rows.find((r) => r.cohort === week)!

describe('cohort maturity — the data layer counts who is actually due', () => {
  it('reports zero due for a cohort no member has aged into', async () => {
    const d = await dash()
    const fresh = cohort(d.cohorts, '2026-09-07')
    expect(fresh.size).toBe(1)
    // Half a day old: not even day 1 has arrived.
    expect([fresh.d1Due, fresh.d7Due, fresh.d30Due]).toEqual([0, 0, 0])
    expect([fresh.d1, fresh.d7, fresh.d30]).toEqual([0, 0, 0])
  })

  it('reports full due for a cohort past every window', async () => {
    const d = await dash()
    const old = cohort(d.cohorts, '2026-06-01')
    expect(old.size).toBe(1)
    expect([old.d1Due, old.d7Due, old.d30Due]).toEqual([1, 1, 1])
  })

  it('counts due per member, so one week can be partly mature', async () => {
    const d = await dash()
    // pA hit day 30 exactly today; pB is four days short of it. Both are long
    // past days 1 and 7.
    const mixed = cohort(d.cohorts, '2026-08-10')
    expect(mixed.size).toBe(2)
    expect(mixed.d1Due).toBe(2)
    expect(mixed.d7Due).toBe(2)
    expect(mixed.d30Due).toBe(1)
  })

  it('uses the same clock boundary as the retention predicate', async () => {
    const d = await dash()
    // The invariant that keeps the two from drifting: nobody can be counted
    // retained on day N without also being counted due on day N. If `matured`
    // and the guard inside `retained` ever diverge, this fails.
    for (const r of d.cohorts) {
      expect(r.d1).toBeLessThanOrEqual(r.d1Due)
      expect(r.d7).toBeLessThanOrEqual(r.d7Due)
      expect(r.d30).toBeLessThanOrEqual(r.d30Due)
    }
  })

  it('populates maturity on the breakdown tables too, not just the cohorts', async () => {
    const d = await dash()
    // The breakdowns are the same accumulator, and each of the four must carry
    // the new fields — a table left on the old shape would silently render
    // every cell as `n/a`, since `due` would be undefined.
    for (const rows of [d.bySource, d.byAccountType, d.byMarket, d.byDevice]) {
      expect(rows.length).toBeGreaterThan(0)
      for (const r of rows) {
        for (const k of ['d1Due', 'd7Due', 'd30Due'] as const) {
          expect(typeof r[k], `${k} on breakdown row ${r.key}`).toBe('number')
        }
      }
    }
    // `newbie` is the only tiktok signup and is too young to measure.
    const tiktok = d.bySource.find((r) => r.key === 'tiktok')!
    expect([tiktok.d1Due, tiktok.d7Due, tiktok.d30Due]).toEqual([0, 0, 0])
  })

  it('leaves the retention counts exactly where they were', async () => {
    const d = await dash()
    // The whole point: this change is a rendering fix. The veteran is retained
    // on all three days; nobody else is retained on anything. Adding maturity
    // moved no retained count and therefore no percentage.
    expect(cohort(d.cohorts, '2026-06-01')).toMatchObject({ d1: 1, d7: 1, d30: 1 })
    expect(cohort(d.cohorts, '2026-08-10')).toMatchObject({ d1: 0, d7: 0, d30: 0 })
    expect(cohort(d.cohorts, '2026-09-07')).toMatchObject({ d1: 0, d7: 0, d30: 0 })
  })
})

/** Render a cell inside the table nesting React expects. */
const cell = (props: { n: number; size: number; due: number; day: number }) =>
  renderToStaticMarkup(
    createElement('table', null,
      createElement('tbody', null,
        createElement('tr', null, createElement(RetentionCell, props)))),
  )

describe('RetentionCell — an immature cell must not read as a measured zero', () => {
  const immature = cell({ n: 0, size: 5, due: 0, day: 30 })
  const measuredZero = cell({ n: 0, size: 5, due: 5, day: 30 })

  it('renders n/a, not 0%, when nobody has reached day N', () => {
    expect(immature).toContain('n/a')
    expect(immature).not.toContain('0%')
    expect(immature).toContain('data-maturity="pending"')
  })

  it('gives an immature cell no heat fill', () => {
    // The gradient is the whole visual argument of the table. Shading an
    // unmeasured cell puts it on the same scale as a measured one.
    expect(immature).not.toContain('background')
  })

  it('still renders a mature zero as 0%', () => {
    // The regression that matters most. Production's zeros are real, and they
    // must keep saying so.
    expect(measuredZero).toContain('0%')
    expect(measuredZero).not.toContain('n/a')
    expect(measuredZero).toContain('data-maturity="measured"')
  })

  it('renders the two states differently', () => {
    expect(immature).not.toEqual(measuredZero)
  })

  it('keeps size as the denominator for a partly mature group', () => {
    // 1 retained of 4 members, only 2 of whom are due. The cell reports 25%
    // (retained/size), NOT 50% (retained/due). Switching to `due` would move
    // every published retention figure — a separate and much larger decision.
    const partial = cell({ n: 1, size: 4, due: 2, day: 7 })
    expect(partial).toContain('25%')
    expect(partial).not.toContain('50%')
    expect(partial).toContain('data-maturity="partial"')
  })

  it('leaves pct() itself unchanged', () => {
    expect(pct(0, 5)).toBe(0)
    expect(pct(1, 4)).toBe(25)
    expect(pct(3, 4)).toBe(75)
    expect(pct(0, 0)).toBe(0)
  })
})

describe('RetentionCell must stay a server module', () => {
  it('has no "use client" directive', () => {
    // It exports `pct`, a plain value, and the cohorts page imports from it.
    // A non-component import from a 'use client' module resolves to a
    // client-reference proxy and throws during the server render — the
    // /admin/feedback crash of 2026-09-04. The structural guard in
    // admin-gate.test.ts sweeps for that, but it keys on PascalCase names and
    // would not flag `pct`, so this file pins the directive directly.
    const src = readFileSync(
      join(process.cwd(), 'src', 'app', 'admin', 'cohorts', 'RetentionCell.tsx'), 'utf8',
    )
    expect(src.trimStart().startsWith("'use client'")).toBe(false)
    expect(src.trimStart().startsWith('"use client"')).toBe(false)
  })
})
