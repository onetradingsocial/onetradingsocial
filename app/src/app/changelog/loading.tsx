// Mirrors changelog/page.tsx: .ts-page @720 > .lb-head > a gap-18 grid of
// .ts-card entries, closed by a faint footnote line.
import { SkelBlock, SkelHead } from '@/app/_components/PageSkeleton'

export default function Loading() {
  return (
    <main className="ts-page" style={{ maxWidth: 720 }} aria-busy="true" aria-label="Loading">
      <SkelHead />
      <div className="mt-5" style={{ display: 'grid', gap: 18 }} aria-hidden>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="ts-card" style={{ display: 'grid', gap: 10 }}>
            {/* title + version badge + date */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <SkelBlock h={19} w="200px" r={7} />
              <SkelBlock h={17} w="52px" r={7} />
              <div style={{ marginLeft: 'auto' }}><SkelBlock h={13} w="86px" r={6} /></div>
            </div>
            <SkelBlock h={14} w="min(52ch, 100%)" r={6} />
            <div style={{ display: 'grid', gap: 6, paddingLeft: 18 }}>
              {Array.from({ length: 3 }).map((_, j) => (
                <SkelBlock key={j} h={13} w={j === 2 ? '58%' : '84%'} r={6} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5" aria-hidden><SkelBlock h={13} w="min(46ch, 100%)" r={6} /></div>
    </main>
  )
}
