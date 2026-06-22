'use client'

import { useRouter, useSearchParams } from 'next/navigation'

const CATS = [
  { key: 'performance', label: 'Performance' },
  { key: 'xp', label: 'XP' },
] as const

export function LeaderboardTabs({ cat }: { cat: string }) {
  const router = useRouter()
  const sp = useSearchParams()
  const go = (next: string) => {
    const p = new URLSearchParams(sp.toString())
    p.set('cat', next)
    p.delete('sort')
    router.push(`/leaderboard?${p.toString()}`)
  }
  return (
    <div className="lb-segs" style={{ marginBottom: 14 }}>
      {CATS.map((c) => (
        <button key={c.key} className={'lb-seg' + (cat === c.key ? ' on' : '')} onClick={() => go(c.key)}>{c.label}</button>
      ))}
    </div>
  )
}
