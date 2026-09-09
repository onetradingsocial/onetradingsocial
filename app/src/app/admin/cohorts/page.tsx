import { requireAdmin } from '@/lib/server/admin'
import { createServiceClient } from '@/lib/supabase/service'
import { getCohortDashboard, type Breakdown } from '@/lib/server/cohorts'
import { Empty, Hint, PageHead, Panel, Section } from '../_components/ui'
import { RetentionCell } from './RetentionCell'

export const dynamic = 'force-dynamic'

function BreakdownTable({ title, rows }: { title: string; rows: Breakdown[] }) {
  return (
    <Panel title={title} flush scroll>
      {rows.length === 0 ? <Empty>No data.</Empty> : (
        <table className="ts-table">
          <thead><tr><th>Segment</th><th className="num">Users</th><th className="num">D1</th><th className="num">D7</th><th className="num">D30</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{r.key}</td>
                <td className="num">{r.size}</td>
                <RetentionCell n={r.d1} size={r.size} due={r.d1Due} day={1} />
                <RetentionCell n={r.d7} size={r.size} due={r.d7Due} day={7} />
                <RetentionCell n={r.d30} size={r.size} due={r.d30Due} day={30} />
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  )
}

/**
 * What this page actually excludes.
 *
 * The badge used to read "Internal excluded", and the subtitle "Internal
 * traffic excluded everywhere". Both over-claimed. Cohorts count PEOPLE, so the
 * only filter available is `profiles.is_internal` (lib/server/cohorts.ts) —
 * one test, applied to the population.
 *
 * The event-based pages apply a second test: they also drop rows stamped
 * `analytics_events.is_internal`. That stamp is not a duplicate of the profile
 * flag. It is where ADMIN traffic gets marked internal — by email allowlist, at
 * write time (api/track/route.ts: `if (isAdmin(user)) isInternal = true`) —
 * rather than onto the profile row, which is not necessarily flagged at all.
 *
 * So an admin whose profile is unflagged is dropped from the event pages and
 * still counted here, in the size and in every retention denominator. The
 * filter is the right one for a population metric and is deliberately left
 * alone; the badge is what was lying, so the badge is what changed.
 */
const INTERNAL_BADGE = (
  <>
    <span className="v-badge vb-broker">Internal profiles excluded</span>
    <Hint text="Excludes profiles flagged is_internal. Cohorts are counted from the profiles table, so that is the only filter that applies here — unlike the event-based pages, which also drop rows stamped analytics_events.is_internal. Admin traffic is marked internal into that stamp by email allowlist, not onto the profile row, so an admin whose profile is not flagged still appears in these figures." />
  </>
)

export default async function CohortsPage() {
  // Audit item 18, F2. The layout gate above this page is NOT the authorisation
  // check: a layout does not re-execute on every navigation within its segment,
  // so a crafted RSC request for a nested page can reach the page without it.
  // Every page below therefore repeats the check itself, which makes the
  // service-role query and its authorisation inseparable. The layout keeps its
  // own call — it renders the nav and must not leak that either.
  await requireAdmin()
  const svc = createServiceClient()
  const d = await getCohortDashboard(svc)

  return (
    <>
      <PageHead
        title="Cohorts"
        sub="Retention = share of the cohort still active on or after day N. A cell reads n/a until the group is old enough for that day to have arrived."
        right={INTERNAL_BADGE}
      />

      <div className="adm-stack">
        <Section title="Weekly signup cohorts" sub="Darker cell = better retention. Read down a column to see whether onboarding changes stuck.">
          <Panel flush scroll>
            {d.cohorts.length === 0 ? <Empty>No cohorts yet.</Empty> : (
              <table className="ts-table">
                <thead><tr><th>Cohort (week of)</th><th className="num">Size</th><th className="num">Day 1</th><th className="num">Day 7</th><th className="num">Day 30</th></tr></thead>
                <tbody>
                  {d.cohorts.map((c) => (
                    <tr key={c.cohort}>
                      <td>{c.cohort}</td>
                      <td className="num">{c.size}</td>
                      <RetentionCell n={c.d1} size={c.size} due={c.d1Due} day={1} />
                      <RetentionCell n={c.d7} size={c.size} due={c.d7Due} day={7} />
                      <RetentionCell n={c.d30} size={c.size} due={c.d30Due} day={30} />
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </Section>

        <Section title="Breakdowns" sub="Same retention maths, sliced by how the user arrived and what they trade.">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
            <BreakdownTable title="By acquisition source" rows={d.bySource} />
            <BreakdownTable title="By account type" rows={d.byAccountType} />
            <BreakdownTable title="By market" rows={d.byMarket} />
            <BreakdownTable title="By device" rows={d.byDevice} />
          </div>
        </Section>
      </div>
    </>
  )
}
