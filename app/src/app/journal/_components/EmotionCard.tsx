import { EMOTIONS } from '@/lib/trade'

export type EmotionTrade = { emotion: string | null; rMultiple: number | null; pnlAmount: number | null }

const EMOJI: Record<string, string> = { calm: '😌', focused: '🎯', excited: '🤩', anxious: '😬' }
const EPS = 1e-9

/**
 * Emotional-state correlations (Sprint 4, row 21). Win rate + avg R per
 * pre-trade emotion, with an explicit small-sample warning so users don't read
 * causation into noise.
 */
export function EmotionCard({ trades, locked }: { trades: EmotionTrade[]; locked: boolean }) {
  if (locked) {
    return (
      <div className="ts-card">
        <h2 className="ts-h2">Emotional state</h2>
        <p className="ts-sub mt-2">
          Capture how you felt before a trade and see how it correlates with results.{' '}
          <a href="/settings/billing" style={{ color: 'var(--violet-br)', fontWeight: 700 }}>Upgrade</a> to unlock.
        </p>
      </div>
    )
  }

  const closed = trades.filter((t) => t.emotion && t.rMultiple != null)
  const rows = EMOTIONS.map((e) => {
    const ts = closed.filter((t) => t.emotion === e)
    const wins = ts.filter((t) => (t.rMultiple ?? 0) > EPS).length
    const avgR = ts.length ? ts.reduce((s, t) => s + (t.rMultiple ?? 0), 0) / ts.length : 0
    return { emotion: e, n: ts.length, winRate: ts.length ? wins / ts.length : 0, avgR }
  }).filter((r) => r.n > 0)

  return (
    <div className="ts-card">
      <h2 className="ts-h2">Emotional state</h2>
      {rows.length === 0 ? (
        <p className="faint mt-3" style={{ fontSize: 13 }}>
          No emotion check-ins yet. Tag how you feel when logging a trade to see correlations here.
        </p>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table className="ts-table mt-3">
              <thead><tr><th>Feeling before</th><th className="num">Trades</th><th className="num">Win rate</th><th className="num">Avg R</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.emotion}>
                    <td style={{ textTransform: 'capitalize' }}>{EMOJI[r.emotion]} {r.emotion}</td>
                    <td className="num">{r.n}</td>
                    <td className="num">{Math.round(r.winRate * 100)}%</td>
                    <td className={'num ' + (r.avgR >= 0 ? 'ts-pos' : 'ts-neg')}>{r.avgR >= 0 ? '+' : ''}{r.avgR.toFixed(2)}R</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.some((r) => r.n < 10) && (
            <p className="faint mt-3" style={{ fontSize: 12 }}>
              ⚠ Some samples are small (&lt;10 trades) — treat these as hints, not proof. Correlation isn&apos;t causation.
            </p>
          )}
        </>
      )}
    </div>
  )
}
