'use client'

import { useState } from 'react'

export type EqPoint = { t: number; v: number }

const TFS: [string, string, number | null][] = [
  ['1w', '1W', 7], ['1m', '1M', 30], ['3m', '3M', 90], ['all', 'All', null],
]

function money(n: number, cur: string) {
  const sym = cur === 'USD' ? '$' : ''
  const body = `${sym}${Math.round(Math.abs(n))}`
  return n < 0 ? `−${body}` : body
}

// Real equity curve over the trader's public closed trades, with a client-side
// timeframe filter. eqstats are precomputed on the server.
export function ProfileEquity({
  points, eqstats, currency,
}: {
  points: EqPoint[]
  eqstats: { k: string; v: string; up?: boolean }[]
  currency: string
}) {
  const [tf, setTf] = useState('1m')
  const days = TFS.find(([k]) => k === tf)?.[2] ?? null
  const cutoff = days != null ? Date.now() - days * 864e5 : 0
  const visible = points.filter((p) => p.t >= cutoff)
  // Always anchor the curve at a zero baseline so a single point still draws.
  const series = visible.length >= 1 ? [{ t: cutoff || points[0]?.t || 0, v: 0 }, ...visible] : []

  const W = 1000, H = 200
  let body = <div className="pf-eq-empty" style={{ color: 'var(--faint)', fontSize: 13, padding: '70px 0', textAlign: 'center' }}>No public trades in this window.</div>
  let yLabels: number[] = []

  if (series.length >= 2) {
    const vals = series.map((p) => p.v)
    let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals)
    if (hi === lo) hi = lo + 1
    const n = series.length
    const step = W / (n - 1)
    const x = (i: number) => i * step
    const y = (v: number) => H - ((v - lo) / (hi - lo)) * (H - 12) - 6
    const pts = series.map((p, i) => [x(i), y(p.v)] as const)
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
    const area = `${line} L ${W} ${H} L 0 ${H} Z`
    yLabels = [0, 1, 2, 3].map((i) => Math.round(hi - (i / 3) * (hi - lo)))
    body = (
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H} style={{ display: 'block', position: 'relative' }}>
        <defs>
          <linearGradient id="pfeqfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#12A56B" stopOpacity="0.26" /><stop offset="1" stopColor="#12A56B" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="pfeqline" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#3FB6E8" /><stop offset="1" stopColor="#12A56B" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#pfeqfill)" />
        <path d={line} fill="none" stroke="url(#pfeqline)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="4" fill="#12A56B" stroke="#fff" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
    )
  }

  return (
    <div className="lb-panel h-reveal">
      <div className="lb-panel-h">
        <h2>Equity curve</h2>
        <div className="pf-seg-mini">
          {TFS.map(([k, l]) => (
            <button key={k} type="button" className={tf === k ? 'on' : ''} onClick={() => setTf(k)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="pf-equity">
        <div className="pf-equity-chart">
          {yLabels.length > 0 && (
            <div className="pf-eq-yaxis">
              {yLabels.map((val, i) => (
                <div key={i} className="gl" style={{ top: (i / 3) * 100 + '%' }}><span>{money(val, currency)}</span></div>
              ))}
            </div>
          )}
          {body}
        </div>
        <div className="pf-eqstats">
          {eqstats.map((s, i) => (
            <div key={i} className="m"><div className="k">{s.k}</div><div className="v" style={{ color: s.up ? 'var(--up)' : 'var(--text)' }}>{s.v}</div></div>
          ))}
        </div>
      </div>
    </div>
  )
}
