// Decorative deterministic sparkline for the stat cards. Not real data — it gives
// each card the mockup's visual texture. Pure/seeded so SSR and client agree.
function rng(seed: number) {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

export function Sparkline({ seed = 7, trend = 2, color = '#7C5CE6', h = 28 }: { seed?: number; trend?: number; color?: string; h?: number }) {
  const n = 26, w = 120, strokeW = 2
  const r = rng(seed)
  const raw: number[] = []
  let v = 50
  for (let i = 0; i < n; i++) { v += (r() - 0.5) * 22 + trend; raw.push(v) }
  const min = Math.min(...raw), max = Math.max(...raw), span = max - min || 1
  const ys = raw.map((p) => (p - min) / span)
  const step = (w - strokeW * 2) / (n - 1)
  const pts = ys.map((y, i) => [strokeW + i * step, strokeW + (1 - y) * (h - strokeW * 2)] as const)
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
  const gid = `sg${seed}-${Math.round(trend * 10)}`
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
