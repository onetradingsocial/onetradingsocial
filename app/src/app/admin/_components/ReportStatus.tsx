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
  const [pending, start] = useTransition()
  return (
    <select
      className="ts-select"
      style={{ width: 'auto', fontSize: 12, padding: '3px 24px 3px 8px' }}
      value={value}
      disabled={pending}
      onChange={(e) => {
        const v = e.target.value
        setValue(v)
        start(async () => { await setTradeReportStatus(id, v) })
      }}
    >
      {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  )
}
