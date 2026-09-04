'use client'

import { useState, useTransition } from 'react'
import { setFeedbackStatus } from '@/app/actions/admin'

const OPTIONS = ['open', 'triaged', 'closed'] as const

/**
 * Triage one feedback item (row 29).
 *
 * The callback passed to `start` MUST be async and MUST await the action —
 * every sibling control on this page (FeedbackCategory, ReportStatus,
 * FeedbackReply) does, and this one did not. A synchronous callback returns
 * before the action settles, so React closes the transition immediately: the
 * select is never really disabled, the router never applies the revalidated
 * tree, and a rejected action becomes an unhandled rejection that takes the
 * page down rather than an error anyone can read.
 *
 * The `{ error }` the action returns is now read, and a failure puts the
 * select back to the status the server still holds. Showing "triaged" on a row
 * the database still calls "open" is worse than showing nothing happened.
 */
export function FeedbackStatus({ id, status }: { id: string; status: string }) {
  const [value, setValue] = useState(status)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  return (
    <>
      <select
        className="ts-select adm-select"
        aria-label="Feedback status"
        value={value}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value as (typeof OPTIONS)[number]
          const prev = value
          setValue(next)
          setError(null)
          start(async () => {
            const res = await setFeedbackStatus(id, next)
            if (res?.error) {
              setValue(prev)
              setError(res.error)
            }
          })
        }}
      >
        {OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      {error && <span style={{ color: 'var(--down)', fontSize: 12.5 }}>{error}</span>}
    </>
  )
}
