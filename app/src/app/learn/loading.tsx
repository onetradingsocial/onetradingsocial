// Mirrors learn/page.tsx: maxWidth 900, an .lb-head with an eyebrow above the
// h1, the always-rendered .learn-hero card, then the 2-up course grid.
// Block flow with mt-6, so no ts-skel-stack on the container.
import { SkelBlock, SkelHead } from '../_components/PageSkeleton'

export default function Loading() {
  return (
    <main className="ts-page" style={{ maxWidth: 900 }}>
      <SkelHead eyebrow />

      {/* learn-hero — progress ring plus a 3-stat row and a boost note */}
      <div className="mt-6"><SkelBlock h={148} r={22} /></div>

      <div className="learn-grid mt-6">
        {Array.from({ length: 4 }).map((_, i) => <SkelBlock key={i} h={212} r={22} />)}
      </div>
    </main>
  )
}
