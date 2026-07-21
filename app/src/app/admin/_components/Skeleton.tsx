// Loading placeholders for admin routes. Each one reuses the real chrome
// (.ad-panel, .ad-stat, .ts-table) and only fakes the text inside, so when the
// data lands nothing moves — the bones are replaced in place.

/** Single shimmering bar. `w` accepts any CSS width. */
export function Bone({ w = '100%', variant = 'text' }: {
  w?: string | number
  variant?: 'text' | 'head' | 'pill' | 'bar'
}) {
  return <span className={`ad-skel ad-skel--${variant}`} style={{ width: w }} />
}

/** Page title + subtitle, matching .ad-head metrics. */
export function HeadSkeleton({ wide }: { wide?: boolean }) {
  return (
    <div className="ad-head" aria-hidden>
      <div style={{ display: 'grid', gap: 10 }}>
        <Bone w={wide ? 260 : 190} variant="head" />
        <Bone w="min(58ch, 100%)" />
      </div>
    </div>
  )
}

export function StatsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="ad-stats" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="ad-stat">
          <Bone w={72} />
          <span style={{ paddingTop: 8 }}><Bone w={54} variant="head" /></span>
        </div>
      ))}
    </div>
  )
}

/** Panel of list rows — mirrors the .ad-row rhythm. */
export function RowsSkeleton({ rows = 5, title = true }: { rows?: number; title?: boolean }) {
  return (
    <div className="ad-panel" aria-hidden>
      {title && <div className="ad-panel-head"><Bone w={120} variant="pill" /></div>}
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="ad-row">
          <Bone w={110} />
          <Bone w={`${34 + ((i * 13) % 30)}%`} />
          <span className="sp"><Bone w={78} variant="pill" /></span>
        </div>
      ))}
    </div>
  )
}

/** Panel wrapping a table — column count drives the header cells. */
export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="ad-panel" aria-hidden>
      <div className="ad-panel-scroll">
        <table className="ts-table">
          <thead>
            <tr>{Array.from({ length: cols }, (_, i) => <th key={i}><Bone w={i === 0 ? 90 : 54} /></th>)}</tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, r) => (
              <tr key={r}>
                {Array.from({ length: cols }, (_, c) => (
                  <td key={c}><Bone w={c === 0 ? `${58 + ((r * 11) % 30)}%` : 40} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Panel of progress meters (funnels, adoption, completions). */
export function MetersSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="ad-panel" aria-hidden>
      <div className="ad-panel-body">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="ad-meter">
            <div className="ad-meter-top">
              <Bone w={`${30 - i * 3}%`} />
              <Bone w={46} />
            </div>
            <div className="ad-meter-track">
              <span className="ad-skel ad-skel--bar" style={{ width: `${84 - i * 17}%`, display: 'block' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Panel containing a field grid — courses, lessons, quiz editor. */
export function FormSkeleton({ fields = 6, textarea }: { fields?: number; textarea?: boolean }) {
  return (
    <div className="ad-panel" aria-hidden>
      <div className="ad-panel-head"><Bone w={110} variant="pill" /></div>
      <div className="ad-panel-body">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {Array.from({ length: fields }, (_, i) => (
            <div key={i} style={{ display: 'grid', gap: 7 }}>
              <Bone w={62} />
              <span className="ad-skel" style={{ height: 46, borderRadius: 12, display: 'block' }} />
            </div>
          ))}
        </div>
        {textarea && (
          <div style={{ display: 'grid', gap: 7 }}>
            <Bone w={92} />
            <span className="ad-skel" style={{ height: 220, borderRadius: 12, display: 'block' }} />
          </div>
        )}
        <span className="ad-skel" style={{ height: 40, width: 132, borderRadius: 10, display: 'block' }} />
      </div>
    </div>
  )
}

/** Section heading above a skeleton block. */
export function SectionSkeleton({ children }: { children: React.ReactNode }) {
  return (
    <section className="ad-sec" aria-hidden>
      <header style={{ display: 'grid', gap: 7 }}>
        <Bone w={150} variant="pill" />
        <Bone w="min(46ch, 100%)" />
      </header>
      {children}
    </section>
  )
}

/**
 * Wrapper for every admin loading.tsx. Announces busy state to screen readers
 * while the visual bones stay hidden from the a11y tree.
 */
export function SkeletonPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="ad-skel-page" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading…</span>
      {children}
    </div>
  )
}
