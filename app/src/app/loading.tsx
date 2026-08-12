// Mirrors HomeArena's shell: .h-app > .h-main > .h-col, with CmdArena,
// StatRow and LogTradeBand as full-width rows *above* the .h-grid split —
// the grid only wraps the feed and the rail.
// The .h-* classes resolve via HomeArena's own import of home-arena.css:
// React hoists every stylesheet in the route tree before render, so the home
// route is styled without this file importing it — and importing it here would
// ship 51.6KB of render-blocking CSS to every route that inherits this
// fallback. Those segments carry their own loading.tsx instead.
import { SkelBlock } from './_components/PageSkeleton'

export default function Loading() {
  return (
    <div className="h-app">
      <div className="h-main">
        <div className="h-col" style={{ gap: 22 }}>
          {/* CmdArena — two-up card (standing | weekly race) */}
          <SkelBlock h={250} r={22} />

          {/* StatRow — section heading over the 5-up .h-stats grid */}
          <div>
            <div className="h-section-h" style={{ marginBottom: 12 }}>
              <SkelBlock h={22} w="180px" r={8} />
              <SkelBlock h={14} w="120px" r={7} />
            </div>
            <div className="h-stats">
              {Array.from({ length: 5 }).map((_, i) => <SkelBlock key={i} h={156} />)}
            </div>
          </div>

          {/* LogTradeBand */}
          <SkelBlock h={98} r={22} />

          <div className="h-grid">
            <div className="h-col">
              <SkelBlock h={112} />
              <div className="h-section-h">
                <SkelBlock h={22} w="170px" r={8} />
                <SkelBlock h={34} w="240px" r={12} />
              </div>
              <SkelBlock h={330} />
              <SkelBlock h={330} />
              <SkelBlock h={330} />
            </div>
            <aside className="h-rail">
              <SkelBlock h={306} />
              <SkelBlock h={232} />
              <SkelBlock h={188} />
            </aside>
          </div>
        </div>
      </div>
    </div>
  )
}
