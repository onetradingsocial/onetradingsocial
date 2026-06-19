import { UserLink } from '@/app/_components/UserLink'
import { FollowButton } from '@/app/_components/FollowButton'
import { marketColor, instrumentBadge } from '@/lib/journal-stats'

type Trader = { id: string; username: string; display_name: string | null; avatar_url: string | null }
type RecentTrade = { id: string; instrument: string; market: string; label: string; pnl: number | null; status: string }
type Leader = { rank: number; username: string; display_name: string | null; avatar_url: string | null; pnl: number }

const QUESTS = [
  { label: 'Log today’s trades', xp: 50, done: false },
  { label: 'Review a losing trade', xp: 60, done: false },
  { label: 'Study 15 min — Risk Mgmt', xp: 80, done: false },
]

export function RightRail({ suggested, recentTrades, leaders }: { suggested: Trader[]; recentTrades: RecentTrade[]; leaders: Leader[] }) {
  const featured = suggested[0]

  return (
    <aside className="ts-feed-side">
      {/* Trader of the week */}
      <div className="ts-totw">
        <div className="ts-totw-glow" />
        <div className="ts-totw-body">
          <p className="eyebrow" style={{ color: 'rgba(255,255,255,0.85)' }}>Trader of the week</p>
          {featured ? (
            <>
              <div className="ts-totw-head">
                <span className="ts-totw-av">{featured.avatar_url ? <img src={featured.avatar_url} alt="" /> : (featured.display_name || featured.username).charAt(0).toUpperCase()}</span>
                <div>
                  <div className="nm">{featured.display_name || featured.username}</div>
                  <div className="un">@{featured.username}</div>
                </div>
              </div>
              <div className="ts-totw-cta">
                <FollowButton targetId={featured.id} initialFollowing={false} />
                <a href={`/app/${featured.username}`} className="btn btn-band-ghost btn-sm">View profile</a>
              </div>
            </>
          ) : (
            <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 8 }}>Featured traders appear as the community grows.</p>
          )}
        </div>
      </div>

      {/* Leaderboard (real, this week) */}
      <div className="ts-card ts-railcard">
        <div className="ts-rail-head"><h2 className="ts-h2">Leaderboard · this week</h2><a href="/app/leaderboard" className="ts-link-sm">All</a></div>
        <div className="ts-lb mt-3">
          {leaders.length === 0
            ? <p className="faint" style={{ fontSize: 13 }}>Rankings populate as traders log public results.</p>
            : leaders.map((t) => (
                <div key={t.username} className="ts-lb-row">
                  <span className={`ts-lb-num ts-lb-num--${t.rank <= 3 ? t.rank : 'x'}`}>{t.rank}</span>
                  <UserLink username={t.username} displayName={t.display_name} avatarUrl={t.avatar_url} />
                  <span className={`ts-lb-val ${t.pnl >= 0 ? 'ts-pos' : 'ts-neg'}`} style={{ fontWeight: 700 }}>
                    {t.pnl >= 0 ? '+' : '−'}${Math.abs(t.pnl).toFixed(0)}
                  </span>
                </div>
              ))}
        </div>
      </div>

      {/* Daily quests */}
      <div className="ts-card ts-railcard">
        <div className="ts-rail-head"><h2 className="ts-h2">Daily quests</h2><span className="ts-soon">0/3 · soon</span></div>
        <div className="ts-quests mt-3">
          {QUESTS.map((q) => (
            <div key={q.label} className="ts-quest">
              <span className="ts-quest-check" data-done={q.done} />
              <span className="ts-quest-label">{q.label}</span>
              <span className="ts-quest-xp">+{q.xp} XP</span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent trades (real, own) */}
      <div className="ts-card ts-railcard">
        <div className="ts-rail-head"><h2 className="ts-h2">Recent trades</h2><a href="/app/journal" className="ts-link-sm">All</a></div>
        <div className="ts-recent mt-3">
          {recentTrades.length === 0
            ? <p className="faint" style={{ fontSize: 13 }}>Log a trade to see it here.</p>
            : recentTrades.map((t) => (
                <a key={t.id} href="/app/journal" className="ts-recent-row">
                  <span className="ts-recent-badge" style={{ background: marketColor(t.market) }}>{instrumentBadge(t.instrument)}</span>
                  <span className="ts-recent-meta"><span className="ins">{t.instrument}</span><span className="lab">{t.label}</span></span>
                  <span className={t.pnl == null ? 'faint' : t.pnl >= 0 ? 'ts-pos' : 'ts-neg'} style={{ fontWeight: 700, fontSize: 13 }}>
                    {t.pnl == null ? 'open' : `${t.pnl >= 0 ? '+' : '−'}$${Math.abs(t.pnl).toFixed(0)}`}
                  </span>
                </a>
              ))}
        </div>
      </div>
    </aside>
  )
}
