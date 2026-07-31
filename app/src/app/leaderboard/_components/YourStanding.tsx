import { fmtPL, fmtUSD } from './format'

// Ink rail card: the viewer's position in the current board view + gap to #1.
export function YourStanding({
  rank, total, pnl, winRate, periodLabel, leaderPnl, leaderHandle, canRank = true,
}: {
  rank: number | null
  total: number
  pnl: number
  winRate: number
  periodLabel: string
  leaderPnl: number | null
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
          <p className="lb-standing-empty">Log public closed trades this period to earn a rank and climb the board.</p>
        ) : (
          <p className="lb-standing-empty">
            Leaderboard ranking is a paid perk.{' '}
            <a href="/settings/billing" style={{ color: 'var(--violet-br)', fontWeight: 700 }}>Upgrade</a>{' '}
            to put your results on the board.
          </p>
        )}
      </div>
    )
  }
  const gap = leaderPnl != null ? Math.max(0, leaderPnl - pnl) : 0
  const pctToLeader = leaderPnl && leaderPnl > 0 ? Math.min(100, Math.max(4, Math.round((pnl / leaderPnl) * 100))) : 100
  return (
    <div className="lb-standing">
      <div className="h-ink-grid" />
      <span className="eyebrow">Your standing · {periodLabel}</span>
      <div className="bigrow">
        <span className="bigrank h-grad-text">#{rank}</span>
        <span className="of">of {total} ranked</span>
      </div>
      <div className="pods">
        <div className="pod"><div className="k">Total P/L</div><div className="v" style={{ color: pnl >= 0 ? 'var(--up-ink)' : 'var(--down-ink)' }}>{fmtPL(pnl)}</div></div>
        <div className="pod"><div className="k">Win rate</div><div className="v">{Math.round(winRate * 100)}%</div></div>
      </div>
      {rank > 1 && leaderHandle && (
        <div className="nextrow">
          <div className="lab"><span>Gap to <b>#1 @{leaderHandle}</b></span><span><b>{fmtUSD(gap)}</b> behind</span></div>
          <div className="h-bar"><i style={{ width: pctToLeader + '%' }} /></div>
        </div>
      )}
    </div>
  )
}
