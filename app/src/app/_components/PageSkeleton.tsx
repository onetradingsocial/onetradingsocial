// Lightweight skeletons rendered instantly while a route's server component
// streams in. Their only job is to commit the navigation immediately so a
// page switch never feels frozen.

export function SkelLine({ w = '100%', h = 14 }: { w?: string; h?: number }) {
  return <div className="ts-skel ts-skel-line" style={{ width: w, height: h }} />
}

/**
 * Un-carded solid block. For stand-ins that must not draw a border —
 * heroes, podium tiles, control bars, charts — where `SkelCard` would paint
 * a frame the real page never renders.
 */
export function SkelBlock({ h = 100, w = '100%', r = 16 }: { h?: number; w?: string; r?: number }) {
  return <div className="ts-skel" style={{ height: h, width: w, borderRadius: r }} />
}

export function SkelCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="ts-skel-card">
      {Array.from({ length: lines }).map((_, i) => (
        <SkelLine key={i} w={i === lines - 1 ? '60%' : '100%'} />
      ))}
    </div>
  )
}

/**
 * `.lb-head` page header — an h1 bone plus a wrapped sub-paragraph.
 * Only for pages whose header really is `.lb-head` (leaderboard, learn);
 * `.ts-hero` pages need their own gradient-panel block instead.
 */
export function SkelHead({ eyebrow }: { eyebrow?: boolean }) {
  return (
    <header className="lb-head"><div className="tx ts-skel-stack">
      {eyebrow && <SkelLine w="120px" h={11} />}
      <SkelLine w="220px" h={28} />
      <SkelLine w="70%" />
    </div></header>
  )
}
