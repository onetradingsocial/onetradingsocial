export function MonthlyPL({ data }: { data: { label: string; pnl: number }[] }) {
  const max = Math.max(1, ...data.map((d) => Math.abs(d.pnl)))
  const W = 340, H = 150, n = data.length, bw = W / n, zero = H * 0.7
  return (
    <svg viewBox={`0 0 ${W} ${H + 18}`} className="ts-chart" preserveAspectRatio="none">
      <line x1="0" y1={zero} x2={W} y2={zero} stroke="var(--border)" strokeDasharray="3 3" />
      {data.map((d, i) => {
        const h = (Math.abs(d.pnl) / max) * (d.pnl >= 0 ? zero : H - zero) * 0.92
        const x = i * bw + bw * 0.28, w = bw * 0.44
        const y = d.pnl >= 0 ? zero - h : zero
        const pos = d.pnl >= 0
        return (
          <g key={d.label}>
            {d.pnl !== 0 && <rect x={x} y={y} width={w} height={Math.max(2, h)} rx={3} fill={pos ? 'var(--up)' : 'var(--down)'} />}
            {d.pnl !== 0 && <text x={x + w / 2} y={(pos ? y : y + h) + (pos ? -4 : 12)} textAnchor="middle" fontSize="8.5" fontWeight="600" fill={pos ? 'var(--up)' : 'var(--down)'}>{pos ? '+' : '−'}{Math.abs(d.pnl) >= 1000 ? (Math.abs(d.pnl) / 1000).toFixed(1) + 'k' : Math.abs(d.pnl).toFixed(0)}</text>}
            <text x={x + w / 2} y={H + 12} textAnchor="middle" fontSize="9" fill="var(--faint)">{d.label}</text>
          </g>
        )
      })}
    </svg>
  )
}
