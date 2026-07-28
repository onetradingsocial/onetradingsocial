'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setCompTier } from '@/app/actions/admin'

type Comp = 'trader' | 'pro' | null
const OPTIONS: { value: Comp; label: string }[] = [
  { value: null, label: 'None' },
  { value: 'trader', label: 'Trader' },
  { value: 'pro', label: 'Pro' },
]

export function CompTierControl({ userId, current }: { userId: string; current: Comp }) {
  const [value, setValue] = useState<Comp>(current)
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const router = useRouter()

  function choose(next: Comp) {
    if (next === value || pending) return
    setErr(null)
    const prev = value
    setValue(next)
    start(async () => {
      const res = await setCompTier(userId, next)
      if (res.error) {
        setValue(prev)
        setErr(res.error)
      } else {
        router.refresh()
      }
    })
  }

  return (
    <div>
      <div className="ts-seg" role="radiogroup" aria-label="Comp tier" aria-busy={pending}>
        {OPTIONS.map((o) => (
          <label key={o.label} data-active={value === o.value}>
            <input
              type="radio"
              name={`comp-${userId}`}
              checked={value === o.value}
              disabled={pending}
              onChange={() => choose(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
      <p className="faint" style={{ fontSize: 12, marginTop: 8, minHeight: 16 }} aria-live="polite">
        {pending
          ? 'Saving…'
          : err
            ? <span style={{ color: 'var(--danger, #c0392b)' }}>{err}</span>
            : value
              ? `Comped ${value}.`
              : 'No comp grant.'}
      </p>
    </div>
  )
}
