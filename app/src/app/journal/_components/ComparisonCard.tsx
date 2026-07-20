import { MIN_COHORT } from '@/lib/compare'
import type { ComparisonData } from '@/lib/server/compare'

function Delta({ value, suffix = '', pts = false }: { value: number; suffix?: string; pts?: boolean }) {
  if (Math.abs(value) < 0.005) return <span className="faint" style={{ fontSize: 12 }}>flat</span>
  const up = value > 0
  const shown = pts ? Math.abs(value * 100).toFixed(0) : Math.abs(value).toFixed(2)
  return (
    <span style={{ fontSize: 12, fontWeight: 700, color: up ? 'var(--up)' : 'var(--down)' }}>
      {up ? '▲' : '▼'} {shown}{suffix}
    </span>
  )
}

/**
 * Trader comparison (row 36): you vs your own previous period, and you vs an
 * anonymised peer cohort. Never names another trader; the benchmark is hidden
 * entirely until the cohort is big enough to be non-identifying.
 */
export function ComparisonCard({ data, windowDays = 30 }: { data: ComparisonData | null; windowDays?: number }) {
  if (!data) return null
  const { self, peers } = data
  const pct = (n: number) => `${Math.round(n * 100)}%`

  if (self.current.trades === 0 && self.previous.trades === 0) {
    return (
      <div className="ts-card">
        <h2 className="ts-h2">How you compare</h2>
        <p className="faint mt-3" style={{ fontSize: 13 }}>
          Close some trades and you&apos;ll see this period vs your last, plus an anonymised peer benchmark.
        </p>
      </div>
    )
  }

  return (
    <div className="ts-card">
      <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h2 className="ts-h2">How you compare</h2>
        <span className="faint" style={{ fontSize: 12 }}>last {windowDays} days vs previous {windowDays}</span>
      </div>

      {/* You vs your own history */}
      <div style={{ overflowX: 'auto' }}>
        <table className="ts-table mt-3">
          <thead><tr><th></th><th className="num">This period</th><th className="num">Previous</th><th className="num">Change</th></tr></thead>
          <tbody>
            <tr>
              <td>Trades</td><td className="num">{self.current.trades}</td><td className="num">{self.previous.trades}</td>
              <td className="num"><Delta value={self.deltas.trades} /></td>
            </tr>
            <tr>
              <td>Win rate</td><td className="num">{pct(self.current.winRate)}</td><td className="num">{pct(self.previous.winRate)}</td>
              <td className="num"><Delta value={self.deltas.winRate} suffix="pts" pts /></td>
            </tr>
            <tr>
              <td>Avg R</td><td className="num">{self.current.avgR.toFixed(2)}R</td><td className="num">{self.previous.avgR.toFixed(2)}R</td>
              <td className="num"><Delta value={self.deltas.avgR} suffix="R" /></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Anonymised peer benchmark */}
      <div className="mt-4" style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 6 }}>
          <strong style={{ fontSize: 14 }}>Peer benchmark</strong>
          <span className="faint" style={{ fontSize: 12 }}>{peers.cohortLabel}</span>
        </div>

        {peers.median === null ? (
          <p className="faint mt-2" style={{ fontSize: 13 }}>
            Not enough traders in your cohort yet ({peers.cohortSize} of {MIN_COHORT} needed).
            Benchmarks stay hidden until the group is large enough to keep everyone anonymous.
          </p>
        ) : (
          <>
            <div className="ts-grid3 mt-3">
              <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '10px 14px' }}>
                <div className="faint" style={{ fontSize: 12 }}>Median win rate</div>
                <div style={{ fontWeight: 700, marginTop: 3 }}>{pct(peers.median.winRate)}</div>
                <div className="faint" style={{ fontSize: 11.5 }}>you: {pct(self.current.winRate)}</div>
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '10px 14px' }}>
                <div className="faint" style={{ fontSize: 12 }}>Median avg R</div>
                <div style={{ fontWeight: 700, marginTop: 3 }}>{peers.median.avgR.toFixed(2)}R</div>
                <div className="faint" style={{ fontSize: 11.5 }}>you: {self.current.avgR.toFixed(2)}R</div>
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '10px 14px' }}>
                <div className="faint" style={{ fontSize: 12 }}>Your percentile</div>
                <div style={{ fontWeight: 700, marginTop: 3 }}>{peers.percentile!.winRate}th <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>win rate</span></div>
                <div className="faint" style={{ fontSize: 11.5 }}>{peers.percentile!.avgR}th on avg R</div>
              </div>
            </div>
            <p className="faint mt-3" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
              Aggregated from {peers.cohortSize} anonymised traders. Medians describe logged behaviour only —
              this is not financial advice or a suggestion to trade like anyone else.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
