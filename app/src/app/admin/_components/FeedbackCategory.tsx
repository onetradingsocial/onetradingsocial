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
  const [pending, start] = useTransition()
  return (
    <select
      className="ts-select"
      style={{ width: 'auto', fontSize: 12.5, padding: '4px 26px 4px 8px' }}
      value={value}
      disabled={pending}
      onChange={(e) => {
        const v = e.target.value
        setValue(v)
        start(async () => { await setFeedbackCategory(id, v || null) })
      }}
    >
      <option value="">— categorise —</option>
      {FEEDBACK_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  )
}
