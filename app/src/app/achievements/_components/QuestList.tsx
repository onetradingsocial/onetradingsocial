import type { QuestProgress } from '@/lib/xp'

export function QuestList({ title, quests, reward }: { title: string; quests: QuestProgress[]; reward: number }) {
  return (
    <div className="ts-card">
      <div className="ts-rail-head"><h2 className="ts-h2">{title}</h2><span className="faint" style={{ fontSize: 12 }}>+{reward} XP each</span></div>
      <ul className="ach-quests mt-3">
        {quests.map((q) => {
          const pct = Math.min(100, Math.round((q.current / q.target) * 100))
          return (
            <li key={q.id} className={'ach-quest' + (q.done ? ' done' : '')}>
              <span className="ach-quest-check" aria-hidden>{q.done ? '✓' : ''}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="ach-quest-top"><b>{q.label}</b><span className="faint">{q.current}/{q.target}</span></div>
                <div className="ach-qbar"><i style={{ width: pct + '%' }} /></div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
