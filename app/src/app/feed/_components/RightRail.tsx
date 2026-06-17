import { SuggestedTraders } from './SuggestedTraders'

type Trader = { id: string; username: string; display_name: string | null; avatar_url: string | null }

export function RightRail({ suggested }: { suggested: Trader[] }) {
  return (
    <aside className="ts-feed-side">
      <div className="ts-card ts-railcard">
        <div className="ts-rail-head"><h2 className="ts-h2">Leaderboard · this week</h2><span className="ts-soon">soon</span></div>
        <p className="faint" style={{ fontSize: 13, marginTop: 8 }}>Weekly trader rankings arrive with the Leaderboard phase.</p>
      </div>
      <SuggestedTraders traders={suggested} />
      <div className="ts-card ts-railcard">
        <div className="ts-rail-head"><h2 className="ts-h2">Daily quests</h2><span className="ts-soon">soon</span></div>
        <p className="faint" style={{ fontSize: 13, marginTop: 8 }}>Earn XP for journaling, reviewing, and learning — coming with the XP phase.</p>
      </div>
    </aside>
  )
}
