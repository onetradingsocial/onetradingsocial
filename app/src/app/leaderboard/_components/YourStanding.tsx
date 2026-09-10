import { fmtPL, fmtMetric } from './format'
import type { PerfSort } from '@/lib/leaderboard'
import Link from 'next/link'

// Ink card: the viewer's position in the current board view + gap to #1.
//
// This is the first block on /leaderboard now, not a right-rail afterthought —
// see the comment at its call site. It is also metric-aware: the board's
// default ranking metric is no longer Total P/L, and a card that headlines a
// money gap under a board ordered by something else tells the reader the wrong
// thing about what separates them from #1.
export function YourStanding({
  rank, total, pnl, winRate, periodLabel, leaderHandle, canRank = true, cohortLabel = null,
  sort, metricLabel, metric, leaderMetric, minRankedTrades,
}: {
  rank: number | null
  /** Size of the viewer's OWN cohort, not the whole board. Ranks restart at 1
   *  per verification cohort (item 15 F5), so "of N" has to match. */
  total: number
  /** e.g. "self-reported traders" — names which board the rank is on, so the
   *  number cannot be read as a position over every trader on the platform. */
  cohortLabel?: string | null
  /** The metric the board is ordered by, and the viewer's / the leader's value
   *  of it. Whatever it is, the gap row is expressed in ITS units. */
  sort: PerfSort
  metricLabel: string
  metric: number
  leaderMetric: number | null
  /** The sample floor in force, so the empty state can name the actual number
   *  of trades a rank needs instead of an open-ended "log trades to rank". */
  minRankedTrades: number
  pnl: number
  winRate: number
  periodLabel: string
  leaderHandle: string | null
  /** False when the viewer's tier isn't eligible to rank — otherwise the empty
   *  state would blame their trade log for an absence upgrading would fix. */
  canRank?: boolean
}) {
  if (!rank) {
    return (
      <div className="lb-standing">
        <div className="h-ink-grid" />
        <span className="eyebrow">Your standing · {periodLabel}</span>
        {canRank ? (
          <p className="lb-standing-empty">
            A rank needs at least {minRankedTrades} public closed trades {periodLabel} — below
            that there is not enough of a sample to rank you honestly, so we don&apos;t.
          </p>
        ) : (
          <p className="lb-standing-empty">
            Leaderboard ranking is a paid perk.{' '}
            <Link href="/settings/billing" style={{ color: 'var(--violet-br)', fontWeight: 700 }}>Upgrade</Link>{' '}
            to put your results on the board.
          </p>
        )}
      </div>
    )
  }
  // Progress toward the leader only makes sense while both values are positive
  // and finite: a negative expectancy or an infinite profit factor has no
  // meaningful percentage, and inventing one would be the same class of
  // overclaim this card exists to avoid.
  const comparable =
    leaderMetric != null && Number.isFinite(leaderMetric) && leaderMetric > 0 && Number.isFinite(metric)
  const pctToLeader = comparable
    ? Math.min(100, Math.max(4, Math.round((Math.max(metric, 0) / leaderMetric!) * 100)))
    : null
  return (
    <div className="lb-standing">
      <div className="h-ink-grid" />
      <span className="eyebrow">Your standing · {periodLabel}</span>
      <div className="bigrow">
        <span className="bigrank h-grad-text">#{rank}</span>
        <span className="of">of {total} ranked{cohortLabel ? ` · ${cohortLabel}` : ''} · by {metricLabel.toLowerCase()}</span>
      </div>
      <div className="pods">
        <div className="pod"><div className="k">{metricLabel}</div><div className="v">{fmtMetric(sort, metric)}</div></div>
        <div className="pod"><div className="k">Total P/L</div><div className="v" style={{ color: pnl >= 0 ? 'var(--up-ink)' : 'var(--down-ink)' }}>{fmtPL(pnl)}</div></div>
        <div className="pod"><div className="k">Win rate</div><div className="v">{Math.round(winRate * 100)}%</div></div>
      </div>
      {rank > 1 && leaderHandle && leaderMetric != null && (
        <div className="nextrow">
          <div className="lab">
            <span>Gap to <b>#1 @{leaderHandle}</b></span>
            <span><b>{fmtMetric(sort, metric)}</b> vs <b>{fmtMetric(sort, leaderMetric)}</b></span>
          </div>
          {pctToLeader != null && <div className="h-bar"><i style={{ width: pctToLeader + '%' }} /></div>}
        </div>
      )}
    </div>
  )
}
