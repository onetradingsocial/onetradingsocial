/**
 * One collapsed strip standing in for every locked journal card.
 * Locked cards render nothing inline — free users see their own journal,
 * not a column of upsells. This sits quietly at the bottom, closed by default.
 */
export function LockedFeatures({ items }: { items: { name: string; tier: 'Trader+' | 'Pro' }[] }) {
  if (items.length === 0) return null

  return (
    <details className="ts-card" style={{ padding: '12px 16px' }}>
      <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="faint" style={{ fontSize: 13 }}>
          {items.length} more journal tool{items.length === 1 ? '' : 's'} on paid plans
        </span>
        <span className="faint" aria-hidden style={{ fontSize: 11, marginLeft: 'auto' }}>▾</span>
      </summary>

      <div className="mt-3" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {items.map((i) => (
          <span key={i.name} className="faint" style={{
            fontSize: 12, padding: '4px 10px', borderRadius: 999,
            border: '1px solid var(--border)', background: 'var(--surface-2)',
          }}>
            {i.name} <span style={{ opacity: 0.6 }}>· {i.tier}</span>
          </span>
        ))}
      </div>

      <p className="faint mt-3" style={{ fontSize: 12.5, margin: '12px 0 0' }}>
        <a href="/settings/billing" style={{ color: 'var(--violet-br)', fontWeight: 700 }}>See plans</a>
      </p>
    </details>
  )
}
