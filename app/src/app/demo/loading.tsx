// Mirrors demo/page.tsx: .ts-page > a .ts-card banner, then StatCards,
// WeeklyReviewCard and RecentTrades each at mt-5, closed by the CTA card.
import { SkelBlock } from '@/app/_components/PageSkeleton'

export default function Loading() {
  return (
    <main className="ts-page" aria-busy="true" aria-label="Loading">
      <div aria-hidden>
        {/* banner card — heading + sub on the left, two buttons on the right */}
        <div
          className="ts-card"
          style={{ padding: '18px 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
        >
          <div style={{ display: 'grid', gap: 8, flex: '1 1 auto', minWidth: 0 }}>
            <SkelBlock h={24} w="180px" r={8} />
            <SkelBlock h={15} w="min(48ch, 100%)" r={7} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <SkelBlock h={40} w="168px" r={11} />
            <SkelBlock h={40} w="150px" r={11} />
          </div>
        </div>

        {/* StatCards — the advanced 5-up grid */}
        <div className="ts-cards5 mt-5">
          {Array.from({ length: 5 }).map((_, i) => <SkelBlock key={i} h={128} r={16} />)}
        </div>

        <div className="mt-5"><SkelBlock h={260} r={16} /></div>
        <div className="mt-5"><SkelBlock h={330} r={16} /></div>

        {/* closing CTA card — centred heading, sub, two buttons */}
        <div className="ts-card mt-5" style={{ padding: '26px 20px', display: 'grid', gap: 10, justifyItems: 'center' }}>
          <SkelBlock h={22} w="300px" r={8} />
          <SkelBlock h={15} w="min(56ch, 100%)" r={7} />
          <div style={{ marginTop: 6, display: 'flex', gap: 10 }}>
            <SkelBlock h={40} w="112px" r={11} />
            <SkelBlock h={40} w="210px" r={11} />
          </div>
        </div>
      </div>
    </main>
  )
}
