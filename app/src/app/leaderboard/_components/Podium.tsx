import Link from 'next/link'
import { Avatar } from './Avatar'
import { fmtPL } from './format'
import { FollowButton } from '@/app/_components/FollowButton'
import type { BoardRow } from './LeaderboardTable'

// Visual order: #2 left, #1 center (elevated), #3 right.
const SLOTS = [
  { idx: 1, tier: 2 },
  { idx: 0, tier: 1 },
  { idx: 2, tier: 3 },
] as const

// `kind='xp'` reuses the BoardRow shape with xp in `pnl` and level in `trades`,
// rendering an "{n} XP" value + a single Level stat instead of money/win-rate stats.
export function Podium({ top, viewerId, kind = 'performance' }: { top: BoardRow[]; viewerId: string; kind?: 'performance' | 'xp' }) {
  if (top.length === 0) return null
  return (
    <div className="lb-podium">
      {SLOTS.map(({ idx, tier }) => {
        const t = top[idx]
        if (!t) return <div key={tier} className={`lb-pod t${tier} lb-pod--empty`} />
        const self = t.userId === viewerId
        return (
          <div key={t.userId} className={`lb-pod t${tier}`}>
            <span className="cap" />
            {tier !== 1 && <span className={`lb-rk g${tier} rankbadge`}>{t.rank}</span>}
            <div className="av-wrap">
              {tier === 1 && (
                <span className="crown" aria-label="1st place">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden>
                    <path d="M2 7l4.5 3.8L12 4l5.5 6.8L22 7l-1.8 11.2H3.8L2 7zm3 13.5h14v1.5H5v-1.5z" />
                  </svg>
                </span>
              )}
              <Avatar src={t.avatarUrl} name={t.displayName || t.username} size={tier === 1 ? 80 : 64} ring />
            </div>
            <div className="name">{t.displayName || t.username}{self && <span className="lb-you">You</span>}</div>
            <div className="handle">@{t.username}</div>
            {kind === 'xp'
              ? <div className="pl up">{t.pnl.toLocaleString()} XP</div>
              : <div className={`pl ${t.pnl >= 0 ? 'up' : 'down'}`}>{fmtPL(t.pnl)}</div>}
            {kind === 'xp'
              ? <div className="pod-stats"><div className="m"><div className="k">Level</div><div className="v">{t.trades}</div></div></div>
              : (
                <div className="pod-stats">
                  <div className="m"><div className="k">Win rate</div><div className="v">{Math.round(t.winRate * 100)}%</div></div>
                  <div className="m"><div className="k">Avg R:R</div><div className="v">{t.avgR.toFixed(1)}</div></div>
                  <div className="m"><div className="k">Trades</div><div className="v">{t.trades}</div></div>
                </div>
              )}
            <div className="pod-btn">
              {self
                ? <Link href={`/${t.username}`} className="h-btn h-btn-grad h-btn-sm">Your profile</Link>
                : <FollowButton targetId={t.userId} initialFollowing={false} />}
            </div>
          </div>
        )
      })}
    </div>
  )
}
