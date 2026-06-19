import type { BoardRow } from './LeaderboardTable'
import { FollowButton } from '@/app/_components/FollowButton'

// Visual order: #2 left, #1 center (elevated), #3 right.
const SLOTS = [1, 0, 2] // indexes into the top-3 array

export function Podium({ top, viewerId }: { top: BoardRow[]; viewerId: string }) {
  if (top.length === 0) return null
  return (
    <div className="ts-podium mt-4">
      {SLOTS.map((idx) => {
        const row = top[idx]
        if (!row) return <div key={idx} className="ts-pod ts-pod--empty" />
        return (
          <div key={row.userId} className={`ts-pod ts-pod--${row.rank}`} data-self={row.userId === viewerId}>
            <div className="ts-pod-rank">{row.rank === 1 ? '👑' : `#${row.rank}`}</div>
            <span className="ts-pod-av">
              {row.avatarUrl ? <img src={row.avatarUrl} alt="" /> : (row.displayName || row.username).charAt(0).toUpperCase()}
            </span>
            <div className="ts-pod-name">{row.displayName || row.username}</div>
            <div className="ts-pod-un">@{row.username}</div>
            <div className="ts-pod-metric">{row.headline}</div>
            <div className="ts-pod-stats">
              {row.winRate != null && <span>{Math.round(row.winRate * 100)}% win</span>}
              {row.avgR != null && <span>{row.avgR.toFixed(2)}R</span>}
              {row.trades != null && <span>{row.trades} trades</span>}
            </div>
            <div className="ts-pod-cta">
              {row.userId === viewerId
                ? <a href={`/app/${row.username}`} className="btn btn-band-ghost btn-sm">View</a>
                : <FollowButton targetId={row.userId} initialFollowing={false} />}
            </div>
          </div>
        )
      })}
    </div>
  )
}
