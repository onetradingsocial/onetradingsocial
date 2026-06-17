export function EquityCurve({ points, final }: { points: number[]; final: number }) {
  const W = 340, H = 150
  if (points.length < 2) {
    return <div className="ts-chart-empty">Close a few trades to see your equity curve.</div>
  }
  const min = Math.min(0, ...points), max = Math.max(1, ...points)
  const sx = (i: number) => (i / (points.length - 1)) * W
  const sy = (v: number) => H - ((v - min) / (max - min || 1)) * (H * 0.82) - 10
  const line = points.map((v, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ')
  const area = `${line} L${W},${H} L0,${H} Z`
  const lastX = sx(points.length - 1), lastY = sy(points[points.length - 1])
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ts-chart" preserveAspectRatio="none">
      <defs>
        <linearGradient id="eqg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--violet)" stopOpacity="0.28" />
          <stop offset="1" stopColor="var(--violet)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#eqg)" />
      <path d={line} fill="none" stroke="var(--violet)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r="4" fill="var(--violet)" stroke="#fff" strokeWidth="2" />
    </svg>
  )
}
