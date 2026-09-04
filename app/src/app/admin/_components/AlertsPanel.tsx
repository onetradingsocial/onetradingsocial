'use client'

import { useState, useTransition } from 'react'
import { ackSystemAlert } from '@/app/actions/admin'
import { When } from './ui'

export type AlertRow = {
  id: number
  kind: string
  message: string
  acked: boolean
  created_at: string
}

/** Open system alerts (error watchdog) with acknowledge = take ownership. */
export function AlertsPanel({ alerts }: { alerts: AlertRow[] }) {
  // Keyed by alert id: `pending` is already panel-wide, but an error belongs to
  // the row whose acknowledge actually failed, not to every row on screen.
  const [error, setError] = useState<{ id: number; message: string } | null>(null)
  const [pending, start] = useTransition()
  if (alerts.length === 0) return null
  return (
    <div className="adm-panel adm-panel--danger">
      <div className="adm-panel-head">
        <span className="t">⚠ Open alerts</span>
        <span className="r"><span className="v-badge vb-failed">{alerts.length}</span></span>
      </div>
      {alerts.map((a) => (
        <div key={a.id} className="adm-row">
          <code className="adm-kv">{a.kind}</code>
          <span style={{ minWidth: 0 }}>{a.message}</span>
          <When iso={a.created_at} short />
          <span className="sp">
            <button
              type="button" className="btn btn-ghost btn-sm" disabled={pending}
              onClick={() => start(async () => {
                setError(null)
                const res = await ackSystemAlert(a.id)
                if (res?.error) setError({ id: a.id, message: res.error })
              })}
            >
              Acknowledge
            </button>
            {error?.id === a.id && (
              <span style={{ color: 'var(--down)', fontSize: 12.5 }}>{error.message}</span>
            )}
          </span>
        </div>
      ))}
    </div>
  )
}
