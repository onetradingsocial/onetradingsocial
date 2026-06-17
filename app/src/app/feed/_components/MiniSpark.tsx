export function MiniSpark({ points, color = 'var(--up)' }: { points: number[]; color?: string }) {
  if (points.length < 2) return <div className="ts-mspark-empty" />
  const W = 96, H = 30
  const min = Math.min(0, ...points), max = Math.max(1, ...points)
  const sx = (i: number) => (i / (points.length - 1)) * W
  const sy = (v: number) => H - ((v - min) / (max - min || 1)) * (H - 4) - 2
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ts-mspark" preserveAspectRatio="none">
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
