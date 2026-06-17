import { marketColor } from '@/lib/journal-stats'

export function AssetDonut({ data, total }: { data: { market: string; count: number; pct: number }[]; total: number }) {
  const cx = 70, cy = 70, mid = 44, sw = 18
  const C = 2 * Math.PI * mid
  let acc = 0
  return (
    <div className="ts-donut-wrap">
      <svg viewBox="0 0 140 140" className="ts-donut">
        <circle cx={cx} cy={cy} r={mid} fill="none" stroke="var(--surface-3)" strokeWidth={sw} />
        {total > 0 && data.map((d) => {
          const frac = d.count / total
          const el = (
            <circle key={d.market} cx={cx} cy={cy} r={mid} fill="none" stroke={marketColor(d.market)}
              strokeWidth={sw} strokeDasharray={`${(frac * C).toFixed(2)} ${C.toFixed(2)}`}
              strokeDashoffset={(-acc * C).toFixed(2)} transform={`rotate(-90 ${cx} ${cy})`} strokeLinecap="butt" />
          )
          acc += frac
          return el
        })}
        <text x={cx} y={cy - 1} textAnchor="middle" fontFamily="var(--display)" fontWeight="700" fontSize="22" fill="var(--text)">{total}</text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="8.5" fill="var(--faint)" letterSpacing="1.5">TRADES</text>
      </svg>
      <ul className="ts-donut-legend">
        {data.length === 0 ? <li className="faint">No trades yet</li> : data.map((d) => (
          <li key={d.market}>
            <span className="dot" style={{ background: marketColor(d.market) }} />
            <span className="cap">{d.market}</span>
            <span className="pct">{d.pct}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
