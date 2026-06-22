import type { LevelInfo } from '@/lib/xp'

export function XpHero({ level, totalXp, questStreak }: { level: LevelInfo; totalXp: number; questStreak: number }) {
  const pct = Math.round(level.progress * 100)
  return (
    <div className="ts-card ach-hero">
      <div className="ach-lvl">
        <span className="ach-lvl-badge grad-text">{level.level}</span>
        <div>
          <p className="eyebrow">Level {level.level}</p>
          <p className="ach-xp">{totalXp.toLocaleString()} XP total</p>
        </div>
        <span className="ts-chip2 ach-streak" style={{ marginLeft: 'auto' }}>🔥 {questStreak}-day quest streak</span>
      </div>
      <div className="ach-bar"><i style={{ width: pct + '%' }} /></div>
      <p className="faint" style={{ fontSize: 13 }}>{level.xpIntoLevel.toLocaleString()} / {level.xpToNext.toLocaleString()} XP to level {level.level + 1}</p>
    </div>
  )
}
