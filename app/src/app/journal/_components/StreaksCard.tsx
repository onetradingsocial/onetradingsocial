import type { Streak } from '@/lib/streaks'

/** Meaningful streaks (Sprint 4, row 34) — process over profit. */
export function StreaksCard({ streaks }: { streaks: Streak[] }) {
  const anyActive = streaks.some((s) => s.days > 0)
  return (
    <div className="ts-card">
      <h2 className="ts-h2">Streaks</h2>
      <p className="ts-sub mt-1">Consecutive days of good process — not trade volume or profit.</p>
      <div className="ts-grid2 mt-3" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
        {streaks.map((s) => (
          <div key={s.id} style={{ textAlign: 'center', padding: '14px 8px', border: '1px solid var(--border)', borderRadius: 12, opacity: s.days > 0 ? 1 : 0.6 }}>
            <div style={{ fontSize: 22 }}>{s.icon}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700 }}>{s.days}</div>
            <div className="faint" style={{ fontSize: 12 }}>{s.label}</div>
          </div>
        ))}
      </div>
      {!anyActive && (
        <p className="faint mt-3" style={{ fontSize: 12.5 }}>Log a trade, finish a lesson or complete a review to start a streak.</p>
      )}
    </div>
  )
}
