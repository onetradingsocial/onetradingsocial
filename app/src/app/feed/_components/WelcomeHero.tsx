import { NewTradeButton } from '@/app/_components/NewTradeButton'
import { UserLink } from '@/app/_components/UserLink'

type Trader = { id: string; username: string; display_name: string | null; avatar_url: string | null }

export function WelcomeHero({ name, streak, race }: { name: string; streak: number; race: Trader[] }) {
  return (
    <div className="ts-hero2">
      <div className="ts-card ts-standing">
        <p className="eyebrow">Your standing · coming soon</p>
        <div className="ts-standing-top">
          <span className="ts-standing-rank grad-text">#—</span>
          <div className="ts-standing-chips">
            <span className="ts-chip2">🏆 Unranked</span>
            {streak !== 0 && (
              <span className={`ts-chip2 ${streak > 0 ? 'ts-chip2--up' : 'ts-chip2--down'}`}>
                {Math.abs(streak)}-trade {streak > 0 ? 'win' : 'loss'} streak
              </span>
            )}
          </div>
        </div>
        <p className="ts-standing-text">
          Welcome back, <b>{name}</b>. Log your setups and build a track record — leagues &amp; rankings arrive with the Leaderboard phase.
        </p>
        <div className="ts-standing-cta">
          <NewTradeButton className="btn btn-primary" label="+ Log a trade" />
          <a href="/app/journal" className="btn btn-ghost">Open journal</a>
        </div>
      </div>

      <div className="ts-card ts-race">
        <div className="flex items-center justify-between">
          <p className="eyebrow">The race · preview</p>
          <span className="ts-soon">soon</span>
        </div>
        <div className="ts-race-list mt-3">
          {race.length === 0
            ? <p className="faint" style={{ fontSize: 13 }}>Follow traders to populate the race.</p>
            : race.map((t, i) => (
                <div key={t.id} className="ts-race-row">
                  <span className="ts-race-num">{i + 1}</span>
                  <UserLink username={t.username} displayName={t.display_name} avatarUrl={t.avatar_url} />
                </div>
              ))}
        </div>
      </div>
    </div>
  )
}
