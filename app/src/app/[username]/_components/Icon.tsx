// Inline icon set ported from the profile mockup (atoms.jsx). Pure SVG — safe in
// server components. Only the icons the profile page uses are included.
import type { CSSProperties, ReactNode } from 'react'

const IP = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

const ICONS: Record<string, ReactNode> = {
  journal: <g {...IP}><path d="M5 4h11l3 3v13H5z" /><path d="M9 9h6M9 13h6M9 17h3" /></g>,
  trophy: <g {...IP}><path d="M8 21h8M12 17v4M6 4h12v5a6 6 0 01-12 0V4z" /><path d="M6 6H3v2a3 3 0 003 3M18 6h3v2a3 3 0 01-3 3" /></g>,
  flame: <path d="M12 3c1 3.5 4.5 4.8 4.5 9a4.5 4.5 0 11-9 0c0-1.6.6-2.7 1.4-3.6.2 1 .8 1.6 1.5 1.8C10 8 9.5 5.5 12 3z" fill="currentColor" stroke="none" />,
  check: <path d="M20 6L9 17l-5-5" {...IP} strokeWidth={2.4} />,
  bolt: <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" fill="currentColor" stroke="none" />,
  trend: <g {...IP}><path d="M3 17l5-5 4 3 8-9" /><path d="M16 6h5v5" /></g>,
  chart: <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" {...IP} />,
  target: <g {...IP}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /></g>,
  scale: <g {...IP}><path d="M12 3v18M5 7h14M7 7l-3 6a3 3 0 006 0L7 7zM17 7l-3 6a3 3 0 006 0l-3-6z" /></g>,
  arrowUp: <path d="M12 19V5M5 12l7-7 7 7" {...IP} />,
  arrowDown: <path d="M12 5v14M19 12l-7 7-7-7" {...IP} />,
  chevR: <path d="M9 6l6 6-6 6" {...IP} />,
  plus: <path d="M12 5v14M5 12h14" {...IP} />,
  book: <path d="M12 4L2 9l10 5 10-5-10-5zM6 11v5c0 1 2.7 2.5 6 2.5s6-1.5 6-2.5v-5" {...IP} />,
  image: <g {...IP}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.5" /><path d="M21 16l-5-5L5 20" /></g>,
  shield: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" {...IP} />,
  clock: <g {...IP}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></g>,
  medal: <g {...IP}><circle cx="12" cy="14" r="6" /><path d="M9 2l3 6 3-6" /><path d="M12 12.5l.9 1.8 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3.9-1.8z" /></g>,
  sliders: <g {...IP}><path d="M4 6h8M16 6h4M4 12h4M12 12h8M4 18h10M18 18h2" /><circle cx="14" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="16" cy="18" r="2" /></g>,
  globe: <g {...IP}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" /></g>,
  pencil: <g {...IP}><path d="M4 20h4L19 9a2 2 0 00-3-3L5 17v3z" /><path d="M14 6l3 3" /></g>,
  users: <g {...IP}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0111 0M16 6.5a3 3 0 010 5.6M19 19a5 5 0 00-3.5-4.8" /></g>,
}

export function Icon({ name, size = 18, style }: { name: string; size?: number; style?: CSSProperties }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} style={style}>{ICONS[name] ?? null}</svg>
}
