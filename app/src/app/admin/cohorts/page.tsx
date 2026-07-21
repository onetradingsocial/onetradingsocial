import { createServiceClient } from '@/lib/supabase/service'
import { getCohortDashboard, type Breakdown } from '@/lib/server/cohorts'
import { Empty, PageHead, Panel, Section } from '../_components/ui'

export const dynamic = 'force-dynamic'

function pct(n: number, d: number) { return d ? Math.round((n / d) * 100) : 0 }

/** Heat cell — opacity encodes retention so a column reads as a gradient. */
function RetentionCell({ n, size }: { n: number; size: number }) {
  const p = pct(n, size)
  return (
    <td
      className="num"
      style={{
        background: p > 0 ? `rgba(124,92,230,${(p / 100) * 0.85 + 0.05})` : undefined,
        color: p > 55 ? '#fff' : undefined,
      }}
    >
      {p}%<span style={{ opacity: 0.6, fontSize: 11, marginLeft: 4 }}>({n})</span>
    </td>
  )
}

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
                <RetentionCell n={r.d1} size={r.size} />
                <RetentionCell n={r.d7} size={r.size} />
                <RetentionCell n={r.d30} size={r.size} />
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  )
}

export default async function CohortsPage() {
  const svc = createServiceClient()
  const d = await getCohortDashboard(svc)

  return (
    <>
      <PageHead
        title="Cohorts"
        sub="Retention = share of the cohort still active on or after day N. Internal traffic excluded everywhere."
        right={<span className="v-badge vb-broker">Internal excluded</span>}
      />

      <div className="ad-stack">
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
                      <RetentionCell n={c.d1} size={c.size} />
                      <RetentionCell n={c.d7} size={c.size} />
                      <RetentionCell n={c.d30} size={c.size} />
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
