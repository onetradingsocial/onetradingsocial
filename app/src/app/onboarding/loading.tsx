// Mirrors onboarding/page.tsx: .ob-app behind a fixed .ob-scrim that centres
// the 940px .ob-card (globals.css:1236, 1261, 1266).
import { SkelBlock } from '@/app/_components/PageSkeleton'

export default function Loading() {
  return (
    <div className="ob-app" aria-busy="true" aria-label="Loading">
      <div className="ob-scrim">
        <div className="ob-card" style={{ padding: '38px 40px', display: 'grid', gap: 16 }} aria-hidden>
          {/* step rail */}
          <div style={{ display: 'flex', gap: 8 }}>
            {Array.from({ length: 4 }).map((_, i) => <SkelBlock key={i} h={6} r={3} />)}
          </div>
          <div style={{ display: 'grid', gap: 9, marginTop: 8 }}>
            <SkelBlock h={30} w="min(22ch, 100%)" r={9} />
            <SkelBlock h={16} w="min(50ch, 100%)" r={7} />
          </div>
          <div style={{ display: 'grid', gap: 12, marginTop: 6 }}>
            {Array.from({ length: 3 }).map((_, i) => <SkelBlock key={i} h={72} r={14} />)}
          </div>
          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between' }}>
            <SkelBlock h={46} w="100px" r={12} />
            <SkelBlock h={46} w="150px" r={12} />
          </div>
        </div>
      </div>
    </div>
  )
}
