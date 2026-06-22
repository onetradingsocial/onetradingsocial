import Link from 'next/link'
import type { QuestProgress } from '@/lib/xp'

export function DailyQuests({ quests }: { quests: QuestProgress[] }) {
  const done = quests.filter((q) => q.done).length
  return (
    <div className="ts-card">
      <div className="ts-rail-head">
        <h2 className="ts-h2">Daily quests</h2>
        <Link href="/achievements" className="ts-link-sm">{done}/{quests.length} · All</Link>
      </div>
      <ul className="ach-quests mt-3">
        {quests.map((q) => (
          <li key={q.id} className={'ach-quest' + (q.done ? ' done' : '')}>
            <span className="ach-quest-check" aria-hidden>{q.done ? '✓' : ''}</span>
            <div className="ach-quest-top" style={{ flex: 1 }}><b>{q.label}</b><span className="faint">{q.current}/{q.target}</span></div>
          </li>
        ))}
      </ul>
    </div>
  )
}
