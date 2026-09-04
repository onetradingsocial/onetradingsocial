// Loading placeholders for admin routes. Each one reuses the real chrome
// (.adm-panel, .adm-stat, .ts-table) and only fakes the text inside, so when the
// data lands nothing moves — the bones are replaced in place.

/** Single shimmering bar. `w` accepts any CSS width. */
export function Bone({ w = '100%', variant = 'text' }: {
  w?: string | number
  variant?: 'text' | 'head' | 'pill' | 'bar'
}) {
  return <span className={`adm-skel adm-skel--${variant}`} style={{ width: w }} />
}

/** Solid block bone — inputs, buttons, chart plots. */
export function Block({ h, w = '100%', r = 12 }: { h: number; w?: string | number; r?: number }) {
  return <span className="adm-skel" style={{ height: h, width: w, borderRadius: r, display: 'block' }} />
}

/**
 * Page title + subtitle, matching .adm-head metrics.
 * `right` mirrors PageHead's right slot (badge, toggle, tab bar); `subLines`
 * matches how far the real sub paragraph wraps — .adm-head p allows 74ch.
 */
export function HeadSkeleton({ wide, right, subLines = 1 }: {
  wide?: boolean
  right?: React.ReactNode
  subLines?: number
}) {
  return (
    <div className="adm-head" aria-hidden>
      <div className="adm-head-row">
        <div style={{ display: 'grid', gap: 10, flex: '1 1 auto', minWidth: 0 }}>
          <Bone w={wide ? 260 : 190} variant="head" />
          <div style={{ display: 'grid', gap: 6 }}>
            {Array.from({ length: subLines }, (_, i) => (
              <Bone key={i} w={i < subLines - 1 ? 'min(74ch, 100%)' : subLines === 1 ? 'min(58ch, 100%)' : 'min(46ch, 100%)'} />
            ))}
          </div>
        </div>
        {right && <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{right}</div>}
      </div>
    </div>
  )
}

/** Segmented filter stand-in — mirrors .adm-tabs. */
export function TabsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="adm-tabs" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="adm-tab" style={{ display: 'flex', alignItems: 'center' }}>
          <Bone w={42 + ((i * 9) % 20)} variant="pill" />
        </span>
      ))}
    </div>
  )
}

export function StatsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="adm-stats" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="adm-stat">
          <Bone w={72} />
          <span style={{ paddingTop: 8 }}><Bone w={54} variant="head" /></span>
        </div>
      ))}
    </div>
  )
}

/**
 * Panel of list rows — mirrors the .adm-row rhythm.
 * `stacked` switches to .adm-row-stack: a meta line plus a wrapped paragraph,
 * which is roughly 2.5x the height of a flat row.
 */
export function RowsSkeleton({ rows = 5, title = true, stacked = false }: {
  rows?: number
  title?: boolean
  stacked?: boolean
}) {
  return (
    <div className="adm-panel" aria-hidden>
      {title && <div className="adm-panel-head"><Bone w={120} variant="pill" /></div>}
      {Array.from({ length: rows }, (_, i) => (
        stacked ? (
          <div key={i} className="adm-row adm-row-stack">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', width: '100%' }}>
              <Bone w={72} variant="pill" />
              <Bone w={110} />
              <span className="sp"><Bone w={104} variant="pill" /><Bone w={88} variant="pill" /></span>
            </div>
            <Bone w="100%" />
            <Bone w={`${52 + ((i * 13) % 34)}%`} />
          </div>
        ) : (
          <div key={i} className="adm-row">
            <Bone w={110} />
            <Bone w={`${34 + ((i * 13) % 30)}%`} />
            <span className="sp"><Bone w={78} variant="pill" /></span>
          </div>
        )
      ))}
    </div>
  )
}

/**
 * Panel wrapping a table — column count drives the header cells.
 * `title` adds the .adm-panel-head bar that <Panel title=…> emits, `scroll`
 * matches the .adm-panel-scroll wrapper, and `widths` mirrors a <colgroup>.
 */
export function TableSkeleton({ rows = 6, cols = 5, title = false, scroll = true, widths }: {
  rows?: number
  cols?: number
  title?: boolean
  scroll?: boolean
  widths?: (number | string | undefined)[]
}) {
  const table = (
    <table className="ts-table" style={widths ? { tableLayout: 'fixed' } : undefined}>
      {widths && (
        <colgroup>
          {Array.from({ length: cols }, (_, i) => <col key={i} style={{ width: widths[i] }} />)}
        </colgroup>
      )}
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
  )
  return (
    <div className="adm-panel" aria-hidden>
      {title && <div className="adm-panel-head"><Bone w={120} variant="pill" /></div>}
      {scroll ? <div className="adm-panel-scroll">{table}</div> : table}
    </div>
  )
}

/** Panel of progress meters (funnels, adoption, completions). */
export function MetersSkeleton({ rows = 4, title = false }: { rows?: number; title?: boolean }) {
  return (
    <div className="adm-panel" aria-hidden>
      {title && <div className="adm-panel-head"><Bone w={140} variant="pill" /></div>}
      <div className="adm-panel-body">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="adm-meter">
            <div className="adm-meter-top">
              <Bone w={`${Math.max(12, 30 - i * 3)}%`} />
              <Bone w={46} />
            </div>
            <div className="adm-meter-track">
              <span className="adm-skel adm-skel--bar" style={{ width: `${Math.max(8, 84 - i * 9)}%`, display: 'block' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Stand-in for <TrendBars>: a titled panel whose body holds the same
 * y-axis / plot / x-axis grid. Plot height matches TrendBars' H + PAD.
 */
export function BarsSkeleton({ bars = 12 }: { bars?: number }) {
  return (
    <div className="adm-panel" aria-hidden>
      <div className="adm-panel-head"><Bone w={130} variant="pill" /></div>
      <div className="adm-panel-body">
        <div className="adm-chart" style={{ margin: 0 }}>
          <div className="adm-chart-y" style={{ height: 92, marginTop: 16 }}>
            <Bone w={18} /><Bone w={18} /><Bone w={18} />
          </div>
          <div className="adm-chart-plot">
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${bars}, minmax(0, 1fr))`, columnGap: '0.3%', alignItems: 'end', height: 108 }}>
              {Array.from({ length: bars }, (_, i) => (
                <span key={i} className="adm-skel" style={{ height: `${28 + ((i * 37) % 62)}%`, borderRadius: 2, display: 'block' }} />
              ))}
            </div>
          </div>
          <div className="adm-chart-x" style={{ gridTemplateColumns: `repeat(${bars}, minmax(0, 1fr))`, columnGap: '0.3%' }}>
            {Array.from({ length: bars }, (_, i) => (
              <span key={i} style={{ display: 'grid', justifyItems: 'center' }}>
                {i % 2 === 0 && <Bone w={26} />}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Panel containing a field grid — courses, lessons, quiz editor.
 * `min` matches the real form's minmax floor so the column count agrees;
 * `textarea` accepts a height because a rows={16} textarea is far taller
 * than the default.
 */
export function FormSkeleton({ fields = 6, textarea, min = 220, textareaHeight = 220 }: {
  fields?: number
  textarea?: boolean
  min?: number
  textareaHeight?: number
}) {
  return (
    <div className="adm-panel" aria-hidden>
      <div className="adm-panel-head"><Bone w={110} variant="pill" /></div>
      <div className="adm-panel-body">
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 12 }}>
          {Array.from({ length: fields }, (_, i) => (
            <div key={i} style={{ display: 'grid', gap: 7 }}>
              <Bone w={62} />
              <Block h={46} />
            </div>
          ))}
        </div>
        {textarea && (
          <div style={{ display: 'grid', gap: 7 }}>
            <Bone w={92} />
            <Block h={textareaHeight} />
          </div>
        )}
        <Block h={40} w={132} r={10} />
      </div>
    </div>
  )
}

/** Section heading above a skeleton block. `right` mirrors Section's right slot. */
export function SectionSkeleton({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="adm-sec" aria-hidden>
      <header className="adm-head-row">
        <div style={{ display: 'grid', gap: 7, flex: '1 1 auto', minWidth: 0 }}>
          <Bone w={150} variant="pill" />
          <Bone w="min(46ch, 100%)" />
        </div>
        {right}
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
    <div className="adm-skel-page" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading…</span>
      {children}
    </div>
  )
}
