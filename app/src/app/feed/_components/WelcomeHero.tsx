import { NewTradeButton } from '@/app/_components/NewTradeButton'

export function WelcomeHero({ name }: { name: string }) {
  return (
    <div className="ts-whero">
      <div className="ts-whero-glow" />
      <div className="ts-whero-body">
        <span className="ts-whero-rank">#—</span>
        <div>
          <p className="ts-hero-eyebrow" style={{ color: 'rgba(255,255,255,0.85)' }}>Your standing · coming soon</p>
          <h1 className="ts-hero-title" style={{ fontSize: 28 }}>Welcome back, {name}</h1>
          <p className="ts-hero-sub">Log today&rsquo;s setups, share your edge, and climb the leaderboard as the season unfolds.</p>
          <div className="ts-whero-cta">
            <NewTradeButton className="btn btn-onband" label="+ Log a trade" />
            <a href="/app/journal" className="btn btn-band-ghost">Open journal</a>
          </div>
        </div>
      </div>
    </div>
  )
}
