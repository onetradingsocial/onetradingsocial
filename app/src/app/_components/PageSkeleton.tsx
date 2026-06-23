// Lightweight skeletons rendered instantly while a route's server component
// streams in. Their only job is to commit the navigation immediately so a
// page switch never feels frozen.

export function SkelLine({ w = '100%', h = 14 }: { w?: string; h?: number }) {
  return <div className="ts-skel ts-skel-line" style={{ width: w, height: h }} />
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

export function SkelHead() {
  return (
    <header className="lb-head"><div className="tx ts-skel-stack">
      <SkelLine w="220px" h={28} />
      <SkelLine w="70%" />
    </div></header>
  )
}
