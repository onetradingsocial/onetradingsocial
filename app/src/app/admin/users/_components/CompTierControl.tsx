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
      <div role="group" aria-label="Comp tier" style={{ display: 'inline-flex', gap: 6 }}>
        {OPTIONS.map((o) => (
          <button
            key={o.label}
            type="button"
            className="v-badge"
            aria-pressed={value === o.value}
            disabled={pending}
            onClick={() => choose(o.value)}
            style={{
              cursor: pending ? 'wait' : 'pointer',
              opacity: value === o.value ? 1 : 0.55,
              fontWeight: value === o.value ? 700 : 400,
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
      {err && <p className="faint" style={{ color: 'var(--danger, #c0392b)', fontSize: 12, marginTop: 6 }}>{err}</p>}
    </div>
  )
}
