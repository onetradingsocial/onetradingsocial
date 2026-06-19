import { UserLink } from '@/app/_components/UserLink'
import { FollowButton } from '@/app/_components/FollowButton'

export type BoardRow = {
  rank: number
  userId: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  headline: string        // formatted metric, e.g. "+$160" or "12 trades"
  barPct: number          // 0..100 proportion bar width
  winRate: number | null  // null hides the cell (non-performance categories)
  avgR: number | null
  trades: number | null
}

const pct = (n: number | null) => (n == null ? '—' : `${Math.round(n * 100)}%`)
const r2 = (n: number | null) => (n == null ? '—' : `${n.toFixed(2)}R`)

export function LeaderboardTable({ rows, viewerId }: { rows: BoardRow[]; viewerId: string }) {
  if (rows.length === 0) {
    return <p className="ts-placeholder mt-3">No ranked trades in this window yet — log public trades to climb.</p>
  }
  return (
    <div className="ts-card ts-board mt-4" style={{ padding: 8 }}>
      <table className="ts-table ts-board-table">
        <thead><tr><th>#</th><th>Trader</th><th>Metric</th><th>Win%</th><th>Avg R</th><th>Trades</th><th></th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.userId} data-self={row.userId === viewerId}>
              <td><span className={`ts-lb-num ts-lb-num--${row.rank <= 3 ? row.rank : 'x'}`}>{row.rank}</span></td>
              <td><UserLink username={row.username} displayName={row.displayName} avatarUrl={row.avatarUrl} /></td>
              <td>
                <div className="ts-board-metric"><span className="val">{row.headline}</span>
                  <span className="ts-board-bar"><i style={{ width: `${row.barPct}%` }} /></span>
                </div>
              </td>
              <td>{pct(row.winRate)}</td>
              <td>{r2(row.avgR)}</td>
              <td>{row.trades ?? '—'}</td>
              <td>{row.userId === viewerId ? <span className="faint">You</span> : <FollowButton targetId={row.userId} initialFollowing={false} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
