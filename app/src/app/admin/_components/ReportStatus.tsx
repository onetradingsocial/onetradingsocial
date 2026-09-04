'use client'

import { useState, useTransition } from 'react'
import { setTradeReportStatus } from '@/app/actions/admin'

const STATUSES: [string, string][] = [
  ['open', 'Open'],
  ['reviewing', 'Reviewing'],
  ['actioned', 'Actioned'],
  ['dismissed', 'Dismissed'],
]

/** Action a user report from the verification dashboard (row 6 / row 52). */
export function ReportStatus({ id, status }: { id: number; status: string }) {
  const [value, setValue] = useState(status)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  return (
    <>
      <select
        className="ts-select adm-select"
        aria-label="Report status"
        value={value}
        disabled={pending}
        onChange={(e) => {
          const v = e.target.value
          const prev = value
          setValue(v)
          setError(null)
          start(async () => {
            const res = await setTradeReportStatus(id, v)
            if (res?.error) {
              setValue(prev)
              setError(res.error)
            }
          })
        }}
      >
        {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {error && <span style={{ color: 'var(--down)', fontSize: 12.5 }}>{error}</span>}
    </>
  )
}
