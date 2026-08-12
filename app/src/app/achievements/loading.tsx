// Mirrors achievements/page.tsx: .ts-page @820 > .lb-head > XpHero >
// .ach-quest-cols (2-up, globals.css:956) > BadgeGrid.
import { SkelBlock, SkelHead } from '@/app/_components/PageSkeleton'

export default function Loading() {
  return (
    <main className="ts-page" style={{ maxWidth: 820 }} aria-busy="true" aria-label="Loading">
      <SkelHead />
      <div aria-hidden>
        {/* XpHero — level ring, XP bar and streak in one panel */}
        <SkelBlock h={182} r={18} />

        <div className="ach-quest-cols mt-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} style={{ display: 'grid', gap: 10 }}>
              <SkelBlock h={20} w="140px" r={8} />
              {Array.from({ length: 3 }).map((_, j) => <SkelBlock key={j} h={62} r={14} />)}
            </div>
          ))}
        </div>

        {/* BadgeGrid */}
        <div className="mt-6" style={{ display: 'grid', gap: 10 }}>
          <SkelBlock h={20} w="120px" r={8} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
            {Array.from({ length: 8 }).map((_, i) => <SkelBlock key={i} h={124} r={14} />)}
          </div>
        </div>
      </div>
    </main>
  )
}
