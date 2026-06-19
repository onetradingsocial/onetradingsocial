import { NewTradeButton } from '@/app/_components/NewTradeButton'
import { UserLink } from '@/app/_components/UserLink'

type Leader = { rank: number; username: string; display_name: string | null; avatar_url: string | null; pnl: number }

export function WelcomeHero({ name, streak, rank, total, race }: { name: string; streak: number; rank: number | null; total: number; race: Leader[] }) {
  return (
    <div className="ts-hero2">
      <div className="ts-card ts-standing">
        <p className="eyebrow">Your standing</p>
        <div className="ts-standing-top">
          <span className="ts-standing-rank grad-text">{rank ? `#${rank}` : '#—'}</span>
          <div className="ts-standing-chips">
            <span className="ts-chip2">🏆 {rank ? `top ${Math.max(1, Math.round((rank / Math.max(1, total)) * 100))}%` : 'Unranked'}</span>
            {streak !== 0 && (
              <span className={`ts-chip2 ${streak > 0 ? 'ts-chip2--up' : 'ts-chip2--down'}`}>
                {Math.abs(streak)}-trade {streak > 0 ? 'win' : 'loss'} streak
              </span>
            )}
          </div>
        </div>
        <p className="ts-standing-text">
          Welcome back, <b>{name}</b>. Log public setups to climb the <a href="/app/leaderboard" className="ts-link-sm">leaderboard</a>.
        </p>
        <div className="ts-chain">
          <span className="ts-chain-label">Your streak</span>
          <div className="ts-chain-dots">
            {Array.from({ length: 7 }).map((_, i) => (
              <span key={i} className="ts-chain-dot" data-on={streak > 0 && i < Math.min(streak, 7)} />
            ))}
          </div>
        </div>
        <div className="ts-standing-cta">
          <NewTradeButton className="btn btn-primary" label="+ Log a trade" />
          <a href="/app/journal" className="btn btn-ghost">Open journal</a>
        </div>
      </div>

      <div className="ts-card ts-race">
        <div className="flex items-center justify-between">
          <p className="eyebrow">The race · this week</p>
          <a href="/app/leaderboard" className="ts-link-sm">All</a>
        </div>
        <div className="ts-race-list mt-3">
          {race.length === 0
            ? <p className="faint" style={{ fontSize: 13 }}>Log public trades to enter the race.</p>
            : race.map((t) => (
                <div key={t.username} className="ts-race-row">
                  <span className="ts-race-num">{t.rank}</span>
                  <UserLink username={t.username} displayName={t.display_name} avatarUrl={t.avatar_url} />
                  <span className={`ts-lb-val ${t.pnl >= 0 ? 'ts-pos' : 'ts-neg'}`} style={{ marginLeft: 'auto', fontWeight: 700 }}>
                    {t.pnl >= 0 ? '+' : '−'}${Math.abs(t.pnl).toFixed(0)}
                  </span>
                </div>
              ))}
        </div>
      </div>
    </div>
  )
}
