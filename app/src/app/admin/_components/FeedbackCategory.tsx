'use client'

import { useState, useTransition } from 'react'
import { setFeedbackCategory } from '@/app/actions/admin'

export const FEEDBACK_CATEGORIES = [
  ['bug', 'Bug'],
  ['confusing_ux', 'Confusing UX'],
  ['missing_feature', 'Missing feature'],
  ['performance', 'Performance'],
  ['verification', 'Verification'],
  ['pricing', 'Pricing'],
  ['trust', 'Trust'],
  ['education', 'Education'],
] as const

/** Admin triage: classify a feedback item (Sprint 2, row 29). */
export function FeedbackCategory({ id, category }: { id: string; category: string | null }) {
  const [value, setValue] = useState(category ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  return (
    <>
      <select
        className="ts-select adm-select"
        aria-label="Feedback category"
        value={value}
        disabled={pending}
        onChange={(e) => {
          const v = e.target.value
          const prev = value
          setValue(v)
          setError(null)
          start(async () => {
            const res = await setFeedbackCategory(id, v || null)
            if (res?.error) {
              setValue(prev)
              setError(res.error)
            }
          })
        }}
      >
        <option value="">— categorise —</option>
        {FEEDBACK_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {error && <span style={{ color: 'var(--down)', fontSize: 12.5 }}>{error}</span>}
    </>
  )
}
