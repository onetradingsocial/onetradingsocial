// Mirrors .ts-msg-page > .ts-msg-shell — a fixed 340px conversation list beside
// the thread pane, both filling calc(100vh - 150px) (globals.css:1523-1524).
import { SkelBlock } from '@/app/_components/PageSkeleton'

export default function Loading() {
  return (
    <main className="ts-msg-page" aria-busy="true" aria-label="Loading">
      <div className="ts-msg-shell" aria-hidden>
        <div className="ts-msg-pane" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 6 }}>
          <SkelBlock h={44} r={12} />
          {Array.from({ length: 8 }).map((_, i) => (
            <SkelBlock key={i} h={66} r={12} />
          ))}
        </div>
        <div className="ts-msg-pane" style={{ display: 'flex', flexDirection: 'column' }}>
          {/* .ts-msg-thread-head — 12px/16px padding around a 40px avatar row */}
          <div style={{ padding: '12px 16px' }}><SkelBlock h={40} r={10} /></div>
          <div style={{ flex: 1 }} />
          <div style={{ padding: '12px 16px' }}><SkelBlock h={46} r={14} /></div>
        </div>
      </div>
    </main>
  )
}
