'use client'

// Ported design atoms from the Arena mockup — icons, data-viz, avatar, delta.
// Kept visually faithful; typed for TS. Avatar adapted to render real avatars.

import type { CSSProperties, ReactNode } from 'react'

const IP = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

const ICONS: Record<string, ReactNode> = {
  home: <path d="M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10" {...IP} />,
  journal: <g {...IP}><path d="M5 4h11l3 3v13H5z" /><path d="M9 9h6M9 13h6M9 17h3" /></g>,
  trophy: <g {...IP}><path d="M8 21h8M12 17v4M6 4h12v5a6 6 0 01-12 0V4z" /><path d="M6 6H3v2a3 3 0 003 3M18 6h3v2a3 3 0 01-3 3" /></g>,
  search: <g {...IP}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></g>,
  bell: <g {...IP}><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 01-3.4 0" /></g>,
  chat: <path d="M21 12a8 8 0 01-11.6 7.1L3 21l1.9-6.4A8 8 0 1121 12z" {...IP} />,
  flame: <path d="M12 3c1 3.5 4.5 4.8 4.5 9a4.5 4.5 0 11-9 0c0-1.6.6-2.7 1.4-3.6.2 1 .8 1.6 1.5 1.8C10 8 9.5 5.5 12 3z" fill="currentColor" stroke="none" />,
  check: <path d="M20 6L9 17l-5-5" {...IP} strokeWidth={2.4} />,
  bolt: <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" fill="currentColor" stroke="none" />,
  trend: <g {...IP}><path d="M3 17l5-5 4 3 8-9" /><path d="M16 6h5v5" /></g>,
  chart: <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" {...IP} />,
  target: <g {...IP}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /></g>,
  scale: <g {...IP}><path d="M12 3v18M5 7h14M7 7l-3 6a3 3 0 006 0L7 7zM17 7l-3 6a3 3 0 006 0l-3-6z" /></g>,
  heart: <path d="M12 20s-7-4.4-9.5-8.5C.8 8.6 2.3 5 5.5 5 7.5 5 9 6.2 12 9c3-2.8 4.5-4 6.5-4 3.2 0 4.7 3.6 3 6.5C19 15.6 12 20 12 20z" {...IP} />,
  bookmark: <path d="M6 4h12v16l-6-4-6 4V4z" {...IP} />,
  copy: <g {...IP}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1" /></g>,
  arrowUp: <path d="M12 19V5M5 12l7-7 7 7" {...IP} />,
  arrowDown: <path d="M12 5v14M19 12l-7 7-7-7" {...IP} />,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" {...IP} />,
  chevR: <path d="M9 6l6 6-6 6" {...IP} />,
  plus: <path d="M12 5v14M5 12h14" {...IP} />,
  crown: <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-1.5 11h-15L3 8z" {...IP} />,
  users: <g {...IP}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0111 0M16 6.5a3 3 0 010 5.6M19 19a5 5 0 00-3.5-4.8" /></g>,
  image: <g {...IP}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.5" /><path d="M21 16l-5-5L5 20" /></g>,
  clock: <g {...IP}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></g>,
  poll: <g {...IP}><path d="M5 20V10M12 20V4M19 20v-7" /></g>,
  globe: <g {...IP}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" /></g>,
  x: <path d="M6 6l12 12M18 6L6 18" {...IP} />,
}

export function Icon({ name, size = 18, style, className }: { name: string; size?: number; style?: CSSProperties; className?: string }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} style={style} className={className}>{ICONS[name] || null}</svg>
}

// deterministic pseudo-random from a seed
function rng(seed: number) { let s = seed % 2147483647; if (s <= 0) s += 2147483646; return () => (s = (s * 16807) % 2147483647) / 2147483647 }

export function buildSeries(seed: number, n: number, trend: number) {
  const r = rng(seed); const pts: number[] = []; let v = 50
  for (let i = 0; i < n; i++) { v += (r() - 0.5) * 22 + trend; pts.push(v) }
  const min = Math.min(...pts), max = Math.max(...pts), span = max - min || 1
  return pts.map((p) => (p - min) / span)
}

// Normalize an explicit data series to 0..1 for plotting.
function normalize(values: number[]) {
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1
  return values.map((v) => (v - min) / span)
}

export function Sparkline({ seed = 7, trend = 2, color = '#7C5CE6', fill = true, w = 120, h = 30, strokeW = 2, values }:
  { seed?: number; trend?: number; color?: string; fill?: boolean; w?: number; h?: number; strokeW?: number; values?: number[] }) {
  // Real data when given (flat baseline if too sparse); seeded shape only when no data is passed.
  const ys = values ? (values.length >= 2 ? normalize(values) : [0.5, 0.5]) : buildSeries(seed, 26, trend)
  const n = ys.length
  const pad = strokeW
  const step = (w - pad * 2) / (n - 1)
  const pts = ys.map((y, i) => [pad + i * step, pad + (1 - y) * (h - pad * 2)] as const)
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
  const gid = 'sg' + seed + '-' + Math.round(trend * 10) + '-' + w
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }}>
      <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={color} stopOpacity="0.28" /><stop offset="1" stopColor={color} stopOpacity="0" />
      </linearGradient></defs>
      {fill && <path d={`${line} L ${pts[n - 1][0]} ${h} L ${pts[0][0]} ${h} Z`} fill={`url(#${gid})`} />}
      <path d={line} fill="none" stroke={color} strokeWidth={strokeW} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[n - 1][0]} cy={pts[n - 1][1]} r={strokeW + 0.6} fill={color} />
    </svg>
  )
}

// Trade chart thumbnail — area line with entry/exit markers.
export function TradeChart({ seed = 7, dir = 'long', win = true, w = 230, h = 116 }:
  { seed?: number; dir?: 'long' | 'short'; win?: boolean; w?: number; h?: number }) {
  const n = 30
  const ys = buildSeries(seed, n, win ? (dir === 'long' ? 2.2 : -2.2) : (dir === 'long' ? -2 : 2))
  const step = w / (n - 1)
  const pts = ys.map((y, i) => [i * step, 14 + (1 - y) * (h - 30)] as const)
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
  const col = win ? '#12A56B' : '#E5475D'
  const ei = 4, xi = n - 4
  const gid = 'tc' + seed
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" style={{ display: 'block' }}>
      <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={col} stopOpacity="0.22" /><stop offset="1" stopColor={col} stopOpacity="0" />
      </linearGradient></defs>
      {[0.3, 0.6].map((g) => <line key={g} x1="0" x2={w} y1={h * g} y2={h * g} stroke="rgba(22,19,40,0.05)" strokeWidth="1" />)}
      <path d={`${line} L ${w} ${h} L 0 ${h} Z`} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={col} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <line x1={pts[ei][0]} x2={pts[ei][0]} y1="6" y2={h - 6} stroke="rgba(22,19,40,0.18)" strokeWidth="1" strokeDasharray="3 3" />
      <line x1={pts[xi][0]} x2={pts[xi][0]} y1="6" y2={h - 6} stroke="rgba(22,19,40,0.18)" strokeWidth="1" strokeDasharray="3 3" />
      <circle cx={pts[ei][0]} cy={pts[ei][1]} r="4" fill="#fff" stroke="#56536B" strokeWidth="2" />
      <circle cx={pts[xi][0]} cy={pts[xi][1]} r="4.5" fill={col} stroke="#fff" strokeWidth="2" />
    </svg>
  )
}

export function StreakChain({ days }: { days: string[] }) {
  const L = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
  return (
    <div className="h-streak-chain">
      {days.map((st, i) => (
        <div key={i} className={'h-day ' + st}>
          <div className="box">
            {st === 'done' && <Icon name="check" size={16} />}
            {st === 'today' && <Icon name="flame" size={15} />}
            {st === 'future' && <Icon name="bolt" size={13} />}
          </div>
          <span className="lbl">{L[i]}</span>
        </div>
      ))}
    </div>
  )
}

const AV_GRADS = [
  'linear-gradient(135deg,#7C5CE6,#C840BC)', 'linear-gradient(135deg,#3FB6E8,#7C5CE6)',
  'linear-gradient(135deg,#FF7A4D,#C840BC)', 'linear-gradient(135deg,#12A56B,#3FB6E8)',
  'linear-gradient(135deg,#E0931E,#FF7A4D)', 'linear-gradient(135deg,#6B43E0,#3FB6E8)',
]

// hashed gradient pick so the same handle keeps a stable colour
function hashSeed(key: string | number) {
  if (typeof key === 'number') return key
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return h
}

export function Avatar({ seed = 1, size = 38, ring = false, src, name }:
  { seed?: string | number; size?: number; ring?: boolean; src?: string | null; name?: string | null }) {
  const bg = AV_GRADS[hashSeed(seed) % AV_GRADS.length]
  const initial = (name || '').trim().charAt(0).toUpperCase()
  const inner = (
    <span style={{ display: 'grid', placeItems: 'center', width: '100%', height: '100%', borderRadius: '50%', background: src ? 'transparent' : bg, color: '#fff', fontFamily: 'var(--display)', fontWeight: 700, fontSize: size * 0.4, overflow: 'hidden' }}>
      {src ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : initial}
    </span>
  )
  if (ring) return (
    <span className="h-av ring" style={{ width: size, height: size }}>
      <span style={{ background: '#fff' }}>{inner}</span>
    </span>
  )
  return <span className="h-av" style={{ width: size, height: size }}>{inner}</span>
}

export function Delta({ v, suffix = '', type }: { v: number; suffix?: string; type?: 'up' | 'down' | 'flat' }) {
  const t = type || (v > 0 ? 'up' : v < 0 ? 'down' : 'flat')
  return (
    <span className={'h-delta h-delta-' + t}>
      {t === 'up' && <Icon name="arrowUp" size={11} />}
      {t === 'down' && <Icon name="arrowDown" size={11} />}
      {v > 0 ? '+' : ''}{v}{suffix}
    </span>
  )
}
