// app/src/app/admin/analytics/_components/TrendBars.tsx
import type { WeekBucket } from '@/lib/analytics'

const H = 92          // plot height in px (SVG user units, y is not stretched)
const PAD = 16        // headroom above the tallest bar, so its value label fits
const GAP = 3         // gap between bars, in the SVG's 1000-unit x space
const VB_W = 1000     // x viewBox width; the SVG stretches horizontally only

/** "2026-07-13" → "13 Jul". Parsed as UTC to match bucketByWeek's toISOString. */
function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/** Round a max up to a readable tick (10 → 10, 43 → 50, 780 → 800). */
function niceMax(n: number): number {
  if (n <= 5) return Math.max(1, n)
  const mag = 10 ** Math.floor(Math.log10(n))
  return Math.ceil(n / (mag / 2)) * (mag / 2)
}

/**
 * Weekly bar chart with labelled axes.
 *
 * Text is rendered as HTML around the SVG rather than inside it: the plot
 * stretches to the panel width, and SVG text would stretch with it. Bars and
 * gridlines are the only things in the SVG, where distortion is harmless.
 */
export function TrendBars({ title, data }: { title: string; data: WeekBucket[] }) {
  const n = Math.max(1, data.length)
  const bw = (VB_W - GAP * (n - 1)) / n
  const peak = Math.max(0, ...data.map((d) => d.count))
  const top = niceMax(peak)
  const total = data.reduce((s, d) => s + d.count, 0)

  // Three ticks reads cleanly at this height; the mid tick is dropped when it
  // would repeat a value (top of 1 → 1 / 0.5 / 0).
  const ticks = top >= 2 ? [top, Math.round(top / 2), 0] : [top, 0]

  // Thin x labels so they never collide: aim for ~6 across the axis, and always
  // keep the most recent week.
  const step = Math.max(1, Math.ceil(n / 6))
  const showLabel = (i: number) => i === n - 1 || (n - 1 - i) % step === 0

  const peakIdx = data.findIndex((d) => d.count === peak)

  return (
    <div className="ad-panel">
      <div className="ad-panel-head">
        <span className="t">{title}</span>
        <span className="r ad-kv">{total} total</span>
      </div>
      <div className="ad-panel-body">
        <figure className="ad-chart" style={{ margin: 0 }}>
          <figcaption className="sr-only">
            {title}. {data.map((d) => `Week of ${shortDate(d.weekStart)}: ${d.count}`).join('. ')}.
          </figcaption>

          <div className="ad-chart-y" style={{ height: H, marginTop: PAD }} aria-hidden>
            {ticks.map((t) => <span key={t}>{t}</span>)}
          </div>

          <div className="ad-chart-plot">
            <svg
              viewBox={`0 0 ${VB_W} ${H + PAD}`} height={H + PAD} preserveAspectRatio="none"
              role="img" aria-label={`${title}: ${total} total, peak ${peak}`}
            >
              <g className="ad-chart-grid">
                {ticks.slice(0, -1).map((t) => {
                  const y = PAD + H - (t / (top || 1)) * H
                  return <line key={t} x1="0" x2={VB_W} y1={y} y2={y} />
                })}
              </g>
              {data.map((d, i) => {
                const h = d.count > 0 ? Math.max(2, (d.count / (top || 1)) * H) : 0
                return (
                  <rect
                    key={d.weekStart}
                    className={`ad-chart-bar${i === n - 1 ? ' ad-chart-bar--last' : ''}`}
                    x={i * (bw + GAP)} y={PAD + H - h} width={bw} height={h} rx={2}
                  >
                    <title>{`Week of ${shortDate(d.weekStart)}: ${d.count}`}</title>
                  </rect>
                )
              })}
              <g className="ad-chart-base">
                <line x1="0" x2={VB_W} y1={PAD + H} y2={PAD + H} />
              </g>
            </svg>

            {/* Only the peak carries a direct value label — a number on every bar
                is noise, and the rest are available on hover. */}
            {peak > 0 && peakIdx >= 0 && (
              <span
                className="ad-chart-peak"
                style={{
                  left: `${((peakIdx * (bw + GAP) + bw / 2) / VB_W) * 100}%`,
                  top: PAD + H - (peak / (top || 1)) * H - 2,
                }}
              >
                {peak}
              </span>
            )}
          </div>

          {/* Same column gap the bars use (GAP/VB_W), so each label centres on
              its bar instead of drifting across the axis. */}
          <div
            className="ad-chart-x"
            style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, columnGap: `${(GAP / VB_W) * 100}%` }}
            aria-hidden
          >
            {data.map((d, i) => (
              <span key={d.weekStart}>{showLabel(i) ? shortDate(d.weekStart) : ''}</span>
            ))}
          </div>
        </figure>
      </div>
    </div>
  )
}
