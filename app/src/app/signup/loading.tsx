// Same AuthShell split as /login (globals.css:1672); the signup form carries a
// third field (username) above email + password.
import { SkelBlock } from '@/app/_components/PageSkeleton'

export default function Loading() {
  return (
    <div className="fl-stage" aria-busy="true" aria-label="Loading">
      <div className="fl-card fl-auth" aria-hidden>
        <div className="fl-aside" />
        <div className="fl-form">
          <SkelBlock h={46} r={13} />

          <div style={{ marginTop: 26, display: 'grid', gap: 7 }}>
            <SkelBlock h={26} w="270px" r={8} />
            <SkelBlock h={16} w="min(38ch, 100%)" r={7} />
          </div>

          <div style={{ marginTop: 22 }}><SkelBlock h={50} r={13} /></div>
          <div style={{ margin: '20px 0' }}><SkelBlock h={1} r={0} /></div>

          <div style={{ display: 'grid', gap: 14 }}>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} style={{ display: 'grid', gap: 7 }}>
                <SkelBlock h={12} w="70px" r={6} />
                <SkelBlock h={50} r={13} />
              </div>
            ))}
          </div>
          <div style={{ marginTop: 20 }}><SkelBlock h={50} r={13} /></div>

          <div style={{ marginTop: 22, display: 'grid', gap: 8, justifyItems: 'center' }}>
            <SkelBlock h={13} w="170px" r={6} />
            <SkelBlock h={13} w="210px" r={6} />
          </div>
        </div>
      </div>
    </div>
  )
}
