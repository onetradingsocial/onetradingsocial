// Mirrors [username]/page.tsx: .h-app > .h-main > .h-grid, with the profile
// hero, stat row, equity chart and style panel in .h-col, and the standing card
// plus widgets in .h-rail.
// Both stylesheets are imported the way the page's own components import them —
// scoped to this segment, so the .h-*/.pf-* rules stay off unrelated routes.
import '../feed/_components/home/home-arena.css'
import './profile.css'
import { SkelBlock } from '@/app/_components/PageSkeleton'

export default function Loading() {
  return (
    <div className="h-app" aria-busy="true" aria-label="Loading">
      <div className="h-main">
        <div className="h-grid" aria-hidden>
          <div className="h-col" style={{ gap: 22 }}>
            {/* .pf-hero — cover band over the identity row */}
            <SkelBlock h={332} r={22} />

            {/* stat row — .h-section-h heading over the 5-up .h-stats grid */}
            <div>
              <div className="h-section-h" style={{ marginBottom: 12 }}>
                <SkelBlock h={22} w="150px" r={8} />
                <SkelBlock h={14} w="110px" r={7} />
              </div>
              <div className="h-stats">
                {Array.from({ length: 5 }).map((_, i) => <SkelBlock key={i} h={156} />)}
              </div>
            </div>

            {/* ProfileEquity, then the "Trading style" .lb-panel */}
            <SkelBlock h={300} r={18} />
            <SkelBlock h={244} r={18} />
          </div>

          <aside className="h-rail">
            {/* .lb-standing, then the most-traded and calendar widgets */}
            <SkelBlock h={286} />
            <SkelBlock h={232} />
            <SkelBlock h={300} />
          </aside>
        </div>
      </div>
    </div>
  )
}
