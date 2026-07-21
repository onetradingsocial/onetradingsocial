// app/src/app/admin/analytics/_components/TrendBars.tsx
import type { WeekBucket } from '@/lib/analytics'

const W = 320
const H = 76
const GAP = 3

/**
 * Weekly bar sparkline. Bars carry a brand gradient with the most recent week
 * fully opaque — the eye lands on "now" first, older weeks recede.
 */
export function TrendBars({ title, data }: { title: string; data: WeekBucket[] }) {
  const n = Math.max(1, data.length)
  const bw = (W - GAP * (n - 1)) / n
  const max = Math.max(1, ...data.map((d) => d.count))
  const total = data.reduce((s, d) => s + d.count, 0)
  const gradId = `tb-${title.replace(/\W+/g, '-').toLowerCase()}`

  return (
    <div className="ad-panel">
      <div className="ad-panel-head">
        <span className="t">{title}</span>
        <span className="r ad-kv">{total} total · peak {max}</span>
      </div>
      <div className="ad-panel-body" style={{ gap: 6 }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`${title}: ${total} total`} preserveAspectRatio="none">
          <defs>
            <linearGradient id={gradId} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="#7C5CE6" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#C840BC" stopOpacity="0.95" />
            </linearGradient>
          </defs>
          {data.map((d, i) => {
            const h = Math.max(d.count > 0 ? 2 : 0, (d.count / max) * (H - 4))
            return (
              <rect
                key={d.weekStart}
                x={i * (bw + GAP)} y={H - h} width={bw} height={h} rx={2}
                fill={`url(#${gradId})`}
                opacity={i === data.length - 1 ? 1 : 0.72}
              >
                <title>{`${d.weekStart}: ${d.count}`}</title>
              </rect>
            )
          })}
        </svg>
        {data.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }} className="ad-kv">
            <span style={{ fontSize: 10.5 }}>{data[0].weekStart}</span>
            <span style={{ fontSize: 10.5 }}>{data[data.length - 1].weekStart}</span>
          </div>
        )}
      </div>
    </div>
  )
}
