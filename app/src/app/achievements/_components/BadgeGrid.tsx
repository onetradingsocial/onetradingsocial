import type { EvaluatedBadge, BadgeCategory } from '@/lib/xp'

const GROUPS: { category: BadgeCategory; title: string }[] = [
  { category: 'trades', title: 'Trade milestones' },
  { category: 'level', title: 'Level milestones' },
  { category: 'questStreak', title: 'Quest streaks' },
  { category: 'winStreak', title: 'Win streaks' },
]

export function BadgeGrid({ badges }: { badges: EvaluatedBadge[] }) {
  return (
    <div className="ts-card">
      <h2 className="ts-h2">Badges</h2>
      {GROUPS.map((g) => (
        <section key={g.category} className="mt-5">
          <p className="eyebrow">{g.title}</p>
          <div className="badge-grid mt-3">
            {badges.filter((b) => b.category === g.category).map((b) => (
              <div key={b.id} className={'badge' + (b.earned ? ' earned' : ' locked')}>
                <span className="badge-dot" aria-hidden>{b.earned ? '★' : '○'}</span>
                <b>{b.label}</b>
                {!b.earned && <span className="faint" style={{ fontSize: 11 }}>{b.current}/{b.threshold}</span>}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
