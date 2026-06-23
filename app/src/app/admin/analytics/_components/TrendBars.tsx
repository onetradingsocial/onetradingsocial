// app/src/app/admin/analytics/_components/TrendBars.tsx
import type { WeekBucket } from '@/lib/analytics'

export function TrendBars({ title, data }: { title: string; data: WeekBucket[] }) {
  const W = 320
  const H = 80
  const gap = 3
  const n = Math.max(1, data.length)
  const bw = (W - gap * (n - 1)) / n
  const max = Math.max(1, ...data.map((d) => d.count))
  return (
    <div className="ts-card" style={{ display: 'grid', gap: 8 }}>
      <span className="faint" style={{ fontSize: 13 }}>{title}</span>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={title}>
        {data.map((d, i) => {
          const h = (d.count / max) * (H - 4)
          return (
            <rect
              key={d.weekStart}
              x={i * (bw + gap)}
              y={H - h}
              width={bw}
              height={h}
              rx={2}
              fill="var(--ts-accent, #4f8cff)"
            >
              <title>{`${d.weekStart}: ${d.count}`}</title>
            </rect>
          )
        })}
      </svg>
    </div>
  )
}
