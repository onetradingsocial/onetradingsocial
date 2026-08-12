// Mirrors feature-board/page.tsx: .ts-page @820 > .lb-head > FeatureBoardClient
// (a filter row over a stack of request cards) at mt-4.
import { SkelBlock, SkelHead } from '@/app/_components/PageSkeleton'

export default function Loading() {
  return (
    <main className="ts-page" style={{ maxWidth: 820 }} aria-busy="true" aria-label="Loading">
      <SkelHead />
      <div className="mt-4" aria-hidden>
        {/* status filter row + submit button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {Array.from({ length: 4 }).map((_, i) => <SkelBlock key={i} h={34} w="92px" r={10} />)}
          <div style={{ marginLeft: 'auto' }}><SkelBlock h={38} w="150px" r={11} /></div>
        </div>
        <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
          {Array.from({ length: 6 }).map((_, i) => <SkelBlock key={i} h={96} r={14} />)}
        </div>
      </div>
    </main>
  )
}
