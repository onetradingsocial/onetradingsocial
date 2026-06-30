// Sparkline for the stat cards — plots a real running series for the metric.
// Falls back to a flat baseline when there aren't enough points to draw a trend.
export function Sparkline({ data, color = '#7C5CE6', h = 28 }: { data: number[]; color?: string; h?: number }) {
  const w = 120, strokeW = 2
  const series = data.length >= 2 ? data : data.length === 1 ? [data[0], data[0]] : [0, 0]
  const n = series.length
  const min = Math.min(...series), max = Math.max(...series), span = max - min || 1
  const ys = series.map((p) => (p - min) / span)
  const step = (w - strokeW * 2) / (n - 1)
  const pts = ys.map((y, i) => [strokeW + i * step, strokeW + (1 - y) * (h - strokeW * 2)] as const)
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
  const gid = `sg-${color.replace(/[^a-z0-9]/gi, '')}-${n}`
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }} aria-hidden>
      <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={color} stopOpacity="0.28" /><stop offset="1" stopColor={color} stopOpacity="0" />
      </linearGradient></defs>
      <path d={`${line} L ${pts[n - 1][0]} ${h} L ${pts[0][0]} ${h} Z`} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={strokeW} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[n - 1][0]} cy={pts[n - 1][1]} r={strokeW + 0.6} fill={color} />
    </svg>
  )
}
