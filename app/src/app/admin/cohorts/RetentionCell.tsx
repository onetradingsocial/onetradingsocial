// Server component (no 'use client', no hooks, no data access) so both the
// cohort table and the breakdown tables can share it — and so a unit test can
// render it without dragging in next/headers or a Supabase client.

/** Retained share of the group, rounded. Denominator is the whole group. */
export function pct(n: number, d: number) { return d ? Math.round((n / d) * 100) : 0 }

export type RetentionCellProps = {
  /** Retained count at day N. */
  n: number
  /** Everyone in the group, matured or not — the percentage's denominator. */
  size: number
  /** How many of `size` have actually reached day N. */
  due: number
  /** 1, 7 or 30 — used in the explanatory title only. */
  day: number
}

/**
 * Heat cell — opacity encodes retention so a column reads as a gradient.
 *
 * `due === 0` is the case this component exists for. A cohort that signed up
 * three days ago has not reached day 30, so its day-30 retention is not zero,
 * it is unknown; the data layer used to report both as `0` and this cell
 * rendered both as `0% (0)`, which reads as a measured failure. It now renders
 * `n/a` — different text, different weight, and no heat fill — so the two are
 * separable at a glance.
 *
 * The percentage itself is untouched: still retained/size, never retained/due.
 * Switching the denominator would move every published retention number, which
 * is a different (and much larger) decision than fixing the empty cell.
 */
export function RetentionCell({ n, size, due, day }: RetentionCellProps) {
  if (due === 0) {
    return (
      <td
        className="num"
        data-maturity="pending"
        style={{ opacity: 0.45, fontStyle: 'italic' }}
        title={`Not measurable yet — nobody in this group has reached day ${day}.`}
      >
        n/a
      </td>
    )
  }

  const p = pct(n, size)
  // Partly-mature groups keep their number (it is a real measurement over the
  // whole group) but say so on hover, because the figure can only go up.
  const partial = due < size
  return (
    <td
      className="num"
      data-maturity={partial ? 'partial' : 'measured'}
      style={{
        background: p > 0 ? `rgba(124,92,230,${(p / 100) * 0.85 + 0.05})` : undefined,
        color: p > 55 ? '#fff' : undefined,
      }}
      title={partial ? `${due} of ${size} have reached day ${day}; the rest are still too new, so this can only rise.` : undefined}
    >
      {p}%<span style={{ opacity: 0.6, fontSize: 11, marginLeft: 4 }}>({n})</span>
    </td>
  )
}
