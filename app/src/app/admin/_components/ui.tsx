// Shared presentational primitives for the admin console. Server-safe (no
// hooks) so every admin page can compose them without a client boundary.
import type { ReactNode } from 'react'

/** Page title block. One per admin route, directly under the shell. */
export function PageHead({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <header className="ad-head">
      <div className="ad-head-row">
        <div>
          <h1>{title}</h1>
          {sub && <p>{sub}</p>}
        </div>
        {right && <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{right}</div>}
      </div>
    </header>
  )
}

/** Titled group inside a page. */
export function Section({ title, sub, right, children }: { title: string; sub?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="ad-sec">
      <header className="ad-head-row">
        <div>
          <h2>{title}</h2>
          {sub && <p>{sub}</p>}
        </div>
        {right}
      </header>
      {children}
    </section>
  )
}

/**
 * Small info marker with a hover/focus tooltip. Server-safe: pure CSS, no JS.
 * `tabIndex` + `aria-label` keep the explanation reachable by keyboard and SR.
 */
export function Hint({ text }: { text: string }) {
  return (
    <span className="ad-hint" tabIndex={0} role="note" aria-label={text} data-tip={text}>
      i
    </span>
  )
}

/** Single metric tile. `tone` colours the value for at-a-glance triage. */
export function Stat({ label, value, sub, tone, hint }: {
  label: string
  value: ReactNode
  sub?: string
  tone?: 'accent' | 'warn'
  hint?: string
}) {
  const cls = tone ? ` ad-stat--${tone}` : ''
  return (
    <div className={`ad-stat${cls}`}>
      <span className="k">{label}{hint && <Hint text={hint} />}</span>
      <span className="v">{value}</span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  )
}

export function Stats({ children }: { children: ReactNode }) {
  return <div className="ad-stats">{children}</div>
}

/**
 * Bordered container for a table or a list of rows.
 * `flush` drops the inner padding so `.ad-row`s or a table sit edge to edge.
 */
export function Panel({ title, right, danger, scroll, flush, children }: {
  title?: string
  right?: ReactNode
  danger?: boolean
  scroll?: boolean
  flush?: boolean
  children: ReactNode
}) {
  return (
    <div className={`ad-panel${danger ? ' ad-panel--danger' : ''}`}>
      {(title || right) && (
        <div className="ad-panel-head">
          {title && <span className="t">{title}</span>}
          {right && <span className="r">{right}</span>}
        </div>
      )}
      {flush
        ? (scroll ? <div className="ad-panel-scroll">{children}</div> : children)
        : <div className={`ad-panel-body${scroll ? ' ad-panel-scroll' : ''}`}>{children}</div>}
    </div>
  )
}

/** Empty state. `ok` = "nothing here and that's good"; otherwise neutral. */
export function Empty({ children, ok }: { children: ReactNode; ok?: boolean }) {
  return (
    <div className={`ad-empty${ok ? '' : ' ad-empty--neutral'}`}>
      <span className="mark" aria-hidden>{ok ? '✓' : '—'}</span>
      <span>{children}</span>
    </div>
  )
}

/** Horizontal progress bar used by funnels and adoption charts. */
export function Meter({ label, note, pct, hint }: { label: ReactNode; note?: ReactNode; pct: number; hint?: string }) {
  return (
    <div className="ad-meter">
      <div className="ad-meter-top">
        <span>{label}{hint && <Hint text={hint} />}</span>
        {note != null && <span className="n">{note}</span>}
      </div>
      <div className="ad-meter-track">
        <i className="ad-meter-fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
    </div>
  )
}

/** Compact absolute timestamp — admins compare rows, so no "3h ago". */
export function When({ iso, short }: { iso: string; short?: boolean }) {
  const d = new Date(iso)
  return (
    <time className="faint" dateTime={iso} style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
      {short
        ? d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        : d.toLocaleString()}
    </time>
  )
}
