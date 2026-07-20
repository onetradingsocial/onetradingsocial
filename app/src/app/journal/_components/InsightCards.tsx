import type { Insight } from '@/lib/insights'

/** Personalised insight cards (Sprint 4, row 22). Each shows its sample size. */
export function InsightCards({ insights, locked }: { insights: Insight[]; locked: boolean }) {
  if (locked) {
    return (
      <div className="ts-card">
        <h2 className="ts-h2">Personalised insights</h2>
        <p className="ts-sub mt-2">
          Statistically-grounded insights about your sessions, setups and streaks.{' '}
          <a href="/settings/billing" style={{ color: 'var(--violet-br)', fontWeight: 700 }}>Upgrade</a> to unlock.
        </p>
      </div>
    )
  }

  return (
    <div className="ts-card">
      <div className="flex items-center justify-between">
        <h2 className="ts-h2">Personalised insights</h2>
        <span className="faint" style={{ fontSize: 12 }}>✦ computed from your trades</span>
      </div>
      {insights.length === 0 ? (
        <p className="faint mt-3" style={{ fontSize: 13 }}>
          Log more trades and we&apos;ll surface patterns here — insights need at least 8 closed trades to be meaningful.
        </p>
      ) : (
        <div className="mt-3" style={{ display: 'grid', gap: 10 }}>
          {insights.map((i) => (
            <div key={i.id} style={{
              display: 'flex', gap: 10, padding: '12px 14px', borderRadius: 12,
              background: i.tone === 'good' ? 'var(--up-soft)' : i.tone === 'bad' ? 'var(--down-soft)' : 'var(--surface-2)',
              border: '1px solid var(--border)',
            }}>
              <span aria-hidden style={{ flexShrink: 0 }}>{i.tone === 'good' ? '📈' : i.tone === 'bad' ? '⚠️' : '✦'}</span>
              <div>
                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5 }}>{i.text}</p>
                <span className="faint" style={{ fontSize: 11.5 }}>Based on {i.sample} trade{i.sample === 1 ? '' : 's'}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
