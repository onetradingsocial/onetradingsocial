// app/tests/unit/analytics-page-claims.test.ts
//
// ── Why this test exists ────────────────────────────────────────────────────
//
// /admin/analytics used to open with "Every figure counts genuine users only."
// It was false in two directions at once, which is worse than an unlabelled
// number: seven of the eight core-funnel bars are `.length` on an event query
// — rows, not people (lib/server/funnel.ts, `eventCount`) — and the internal
// exclusion is applied by different rules for event-derived and table-derived
// figures. This is the page the roadmap points the founder at for baselines,
// so a confident wrong caption is the expensive kind of wrong.
//
// The funnel itself is not rebuilt on distinct users here; that is a larger
// piece of work. This pins the smaller promise: the page describes what it
// actually counts, and the tooltip for a bar cannot drift away from the bar's
// label.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getFunnelDashboard } from '@/lib/server/funnel'
import type { SupabaseClient } from '@supabase/supabase-js'

const ROOT = join(__dirname, '..', '..', '..')
const page = readFileSync(join(ROOT, 'app/src/app/admin/analytics/page.tsx'), 'utf8')

/** The page header's own copy — not the comment above it, which quotes the
 *  sentence this replaced and is meant to keep quoting it. */
const sub = page.slice(page.indexOf('title="Analytics"'), page.indexOf('right={<span'))

describe('the analytics page describes what it counts', () => {
  it('no longer claims every figure counts users', () => {
    expect(sub).not.toContain('Every figure counts genuine users only')
    // The claim that IS true — internal traffic is out everywhere — survives.
    expect(page).toContain('Internal excluded')
  })

  it('says that the funnel counts events and the tables count users', () => {
    expect(sub).toMatch(/count events/)
    expect(sub).toMatch(/distinct users/)
    // The exclusion promise has to stay, because it is the one thing the page
    // does do everywhere — including, since this workstream, the broken-paths
    // panel, which is what it used to be wrong about.
    expect(sub).toMatch(/excluded from every figure/)
  })

  it('does not describe the event-counted bars as users', () => {
    // The tooltips carried the same false claim as the caption. The first bar
    // is the only one measured in people.
    const hints = page.slice(page.indexOf('const HINTS'), page.indexOf('function FunnelBars'))
    const eventBars = hints.slice(hints.indexOf("'Signups completed'"), hints.indexOf('// Broker connect'))
    expect(eventBars).not.toMatch(/^\s*'[^']+': 'Users who/m)
  })
})

describe('every funnel bar keeps its tooltip', () => {
  it('has a HINTS entry for each step label the dashboard returns', async () => {
    // HINTS is keyed by label, so renaming a step (as "App visitors (est.)"
    // just did) silently drops that bar's explanation. Nothing else notices.
    const svc = {
      from: () => {
        const b: Record<string, unknown> = {}
        const self = () => b
        for (const m of ['select', 'eq', 'neq', 'not', 'in', 'gte', 'order', 'limit']) b[m] = self
        b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r)
        return b
      },
    } as unknown as SupabaseClient
    const f = await getFunnelDashboard(svc)
    // Keys are quoted unless the label is a bare identifier (`Subscribed`).
    const key = (label: string) =>
      new RegExp(`(^|[{\\s])'?${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'?:`, 'm')
    for (const row of [...f.funnel, ...f.brokerFunnel]) {
      expect(page, `no HINTS entry for "${row.step}"`).toMatch(key(row.step))
    }
  })
})
