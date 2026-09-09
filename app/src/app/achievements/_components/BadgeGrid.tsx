import type { EvaluatedBadge, BadgeCategory } from '@/lib/xp'

// Audit 2026-09-05, P0: 'Trade milestones' (1/10/50/100/500 closed trades) and
// 'Win streaks' (5/10 consecutive winners) are gone — both were badges you could
// only move by taking another trade. 'Reviews' replaces them; 'lessons' stays
// omitted while Learn is withdrawn.
const GROUPS: { category: BadgeCategory; title: string }[] = [
  { category: 'reviews', title: 'Review milestones' },
  { category: 'level', title: 'Level milestones' },
  { category: 'questStreak', title: 'Process streaks' },
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
