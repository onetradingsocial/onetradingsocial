import Link from 'next/link'

export type ChecklistItem = { key: string; label: string; done: boolean; href: string }

/**
 * Persistent onboarding checklist (Sprint 2, row 14). Rendered until every
 * item is complete, then disappears for good. Each item deep-links to the
 * place where it gets done.
 */
export function OnboardingChecklist({ items }: { items: ChecklistItem[] }) {
  const done = items.filter((i) => i.done).length
  if (done === items.length) return null
  const pct = Math.round((done / items.length) * 100)
  return (
    <div className="ts-card" style={{ maxWidth: 1280, margin: '18px auto 0', padding: '14px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <strong style={{ fontFamily: 'var(--font-display)' }}>Get set up — {done}/{items.length}</strong>
        <span className="faint" style={{ fontSize: 12.5 }}>Finish the list to squeeze the most out of your first week (+XP)</span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: 'var(--surface-3)', overflow: 'hidden', margin: '10px 0 12px' }}>
        <i style={{ display: 'block', height: '100%', width: `${pct}%`, background: 'var(--brand-grad)' }} />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {items.map((i) => (
          <Link
            key={i.key}
            href={i.href}
            prefetch={false}
            className="ts-chip"
            style={{
              textDecoration: 'none',
              ...(i.done ? { opacity: 0.55, textDecoration: 'line-through' } : { borderColor: 'var(--border-vio)' }),
            }}
          >
            {i.done ? '✓ ' : ''}{i.label}
          </Link>
        ))}
      </div>
    </div>
  )
}
