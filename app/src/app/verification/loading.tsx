// Mirrors verification/page.tsx, which styles itself inline rather than with
// classes: main at maxWidth 760 / padding '40px 20px 80px', an h1, intro copy,
// then bordered level cards under section headings (page.tsx:11-17).
import { SkelBlock } from '@/app/_components/PageSkeleton'

const CARD: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 14,
  padding: '16px 18px',
  margin: '14px 0',
  background: 'var(--surface)',
  display: 'grid',
  gap: 9,
}

export default function Loading() {
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '40px 20px 80px' }} aria-busy="true" aria-label="Loading">
      <div aria-hidden>
        <SkelBlock h={30} w="380px" r={8} />
        <div style={{ margin: '18px 0', display: 'grid', gap: 8 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <SkelBlock key={i} h={14} w={i === 2 ? '62%' : '100%'} r={6} />
          ))}
        </div>

        <div style={{ margin: '36px 0 10px' }}><SkelBlock h={20} w="250px" r={7} /></div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={CARD}>
            <SkelBlock h={22} w="150px" r={999} />
            {Array.from({ length: 3 }).map((_, j) => (
              <SkelBlock key={j} h={14} w={j === 2 ? '54%' : '100%'} r={6} />
            ))}
          </div>
        ))}
      </div>
    </main>
  )
}
