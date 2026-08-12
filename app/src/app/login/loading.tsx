// Mirrors AuthShell: .fl-stage centres a .fl-card.fl-auth split 0.86fr / 1fr
// at min-height 624px (globals.css:1672). The dark brand aside is drawn as one
// solid panel — it is decorative, so a single block reads truer than bones.
import { SkelBlock } from '@/app/_components/PageSkeleton'

export default function Loading() {
  return (
    <div className="fl-stage" aria-busy="true" aria-label="Loading">
      <div className="fl-card fl-auth" aria-hidden>
        <div className="fl-aside" />
        <div className="fl-form">
          {/* .fl-tabs — two-up segmented control */}
          <SkelBlock h={46} r={13} />

          {/* .fl-head — h1 + sub, margin-top 26 */}
          <div style={{ marginTop: 26, display: 'grid', gap: 7 }}>
            <SkelBlock h={26} w="240px" r={8} />
            <SkelBlock h={16} w="min(38ch, 100%)" r={7} />
          </div>

          {/* .fl-oauth (50px, margin-top 22) then .fl-or (20px margins) */}
          <div style={{ marginTop: 22 }}><SkelBlock h={50} r={13} /></div>
          <div style={{ margin: '20px 0' }}><SkelBlock h={1} r={0} /></div>

          {/* .fl-fields — email + password, then submit */}
          <div style={{ display: 'grid', gap: 14 }}>
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} style={{ display: 'grid', gap: 7 }}>
                <SkelBlock h={12} w="70px" r={6} />
                <SkelBlock h={50} r={13} />
              </div>
            ))}
          </div>
          <div style={{ marginTop: 20 }}><SkelBlock h={50} r={13} /></div>

          {/* .fl-foot */}
          <div style={{ marginTop: 22, display: 'grid', gap: 8, justifyItems: 'center' }}>
            <SkelBlock h={13} w="170px" r={6} />
            <SkelBlock h={13} w="210px" r={6} />
          </div>
        </div>
      </div>
    </div>
  )
}
