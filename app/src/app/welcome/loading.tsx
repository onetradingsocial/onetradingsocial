// Mirrors welcome/page.tsx: the funnel variant .fl-stage.fl-stage--full covers
// the app nav (globals.css:1657) and centres the TrialWelcome card.
import { SkelBlock } from '@/app/_components/PageSkeleton'

export default function Loading() {
  return (
    <div className="fl-stage fl-stage--full" aria-busy="true" aria-label="Loading">
      <div className="fl-card" style={{ maxWidth: 760, padding: '40px 44px', display: 'grid', gap: 14, justifyItems: 'center' }} aria-hidden>
        <SkelBlock h={12} w="130px" r={6} />
        <SkelBlock h={32} w="min(24ch, 100%)" r={9} />
        <SkelBlock h={16} w="min(46ch, 100%)" r={7} />
        <div style={{ marginTop: 10, width: '100%', display: 'grid', gap: 10 }}>
          {Array.from({ length: 3 }).map((_, i) => <SkelBlock key={i} h={62} r={14} />)}
        </div>
        <div style={{ marginTop: 12 }}><SkelBlock h={50} w="230px" r={13} /></div>
      </div>
    </div>
  )
}
