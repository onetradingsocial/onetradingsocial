'use client'

import { useState, useTransition } from 'react'
import { setFeedbackStatus } from '@/app/actions/admin'

const OPTIONS = ['open', 'triaged', 'closed'] as const

export function FeedbackStatus({ id, status }: { id: string; status: string }) {
  const [value, setValue] = useState(status)
  const [pending, start] = useTransition()
  return (
    <select
      value={value}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value as (typeof OPTIONS)[number]
        setValue(next)
        start(() => { setFeedbackStatus(id, next) })
      }}
    >
      {OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}
