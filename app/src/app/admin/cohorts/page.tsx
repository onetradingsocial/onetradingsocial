import { createServiceClient } from '@/lib/supabase/service'
import { getCohortDashboard, type Breakdown } from '@/lib/server/cohorts'

export const dynamic = 'force-dynamic'

function pct(n: number, d: number) { return d ? Math.round((n / d) * 100) : 0 }

function RetentionCell({ n, size }: { n: number; size: number }) {
  const p = pct(n, size)
  const bg = `rgba(124,92,230,${(p / 100) * 0.85 + 0.05})`
  return (
    <td className="num" style={{ background: p > 0 ? bg : undefined, color: p > 55 ? '#fff' : undefined }}>
      {p}% <span style={{ opacity: 0.6, fontSize: 11 }}>({n})</span>
    </td>
  )
}

function BreakdownTable({ title, rows }: { title: string; rows: Breakdown[] }) {
  return (
    <div className="ts-card">
      <span className="faint" style={{ fontSize: 13 }}>{title}</span>
      <div style={{ overflowX: 'auto' }} className="mt-3">
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
      </div>
    </div>
  )
}

export default async function CohortsPage() {
  const svc = createServiceClient()
  const d = await getCohortDashboard(svc)

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <section style={{ display: 'grid', gap: 10 }}>
        <div>
          <h2 className="ts-h2">Weekly signup cohorts</h2>
          <p className="ts-sub">Retention = share of the cohort still active on/after day N. Internal traffic excluded.</p>
        </div>
        <div className="ts-card" style={{ overflowX: 'auto' }}>
          <table className="ts-table">
            <thead><tr><th>Cohort (week of)</th><th className="num">Size</th><th className="num">Day 1</th><th className="num">Day 7</th><th className="num">Day 30</th></tr></thead>
            <tbody>
              {d.cohorts.length === 0 ? (
                <tr><td colSpan={5} className="faint" style={{ textAlign: 'center', padding: 20 }}>No cohorts yet.</td></tr>
              ) : d.cohorts.map((c) => (
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
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 16 }}>
        <BreakdownTable title="By acquisition source" rows={d.bySource} />
        <BreakdownTable title="By account type" rows={d.byAccountType} />
        <BreakdownTable title="By market" rows={d.byMarket} />
        <BreakdownTable title="By device" rows={d.byDevice} />
      </div>
    </div>
  )
}
