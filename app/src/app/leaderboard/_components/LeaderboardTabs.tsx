'use client'

import { useRouter, useSearchParams } from 'next/navigation'

const TABS = [
  { key: 'performance', label: 'Performance' },
  { key: 'consistency', label: 'Consistency' },
  { key: 'followed', label: 'Most Followed' },
] as const
const SOON = ['XP', 'Learning']

export function LeaderboardTabs({ active }: { active: string }) {
  const router = useRouter()
  const sp = useSearchParams()
  const go = (cat: string) => {
    const period = sp.get('period') ?? 'week'
    router.push(`/leaderboard?cat=${cat}&period=${period}`)
  }
  return (
    <div className="ts-lbtabs">
      {TABS.map((t) => (
        <button key={t.key} className="ts-lbtab" data-active={active === t.key} onClick={() => go(t.key)}>{t.label}</button>
      ))}
      {SOON.map((s) => (
        <span key={s} className="ts-lbtab ts-lbtab--soon" title={`${s} — coming soon`}>{s}<span className="ts-soon">soon</span></span>
      ))}
    </div>
  )
}
