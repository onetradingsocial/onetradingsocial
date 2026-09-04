'use client'

import { useState, useTransition } from 'react'
import { setFeedbackCategory } from '@/app/actions/admin'
import { FEEDBACK_CATEGORIES } from '@/lib/feedback'

/** Admin triage: classify a feedback item (Sprint 2, row 29). */
export function FeedbackCategory({ id, category }: { id: string; category: string | null }) {
  const [value, setValue] = useState(category ?? '')
  const [pending, start] = useTransition()
  return (
    <select
      className="ts-select adm-select"
      aria-label="Feedback category"
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
