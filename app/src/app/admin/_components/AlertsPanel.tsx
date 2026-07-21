'use client'

import { useTransition } from 'react'
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
  const [pending, start] = useTransition()
  if (alerts.length === 0) return null
  return (
    <div className="ad-panel ad-panel--danger">
      <div className="ad-panel-head">
        <span className="t">⚠ Open alerts</span>
        <span className="r"><span className="v-badge vb-failed">{alerts.length}</span></span>
      </div>
      {alerts.map((a) => (
        <div key={a.id} className="ad-row">
          <code className="ad-kv">{a.kind}</code>
          <span style={{ minWidth: 0 }}>{a.message}</span>
          <When iso={a.created_at} short />
          <span className="sp">
            <button
              type="button" className="btn btn-ghost btn-sm" disabled={pending}
              onClick={() => start(async () => { await ackSystemAlert(a.id) })}
            >
              Acknowledge
            </button>
          </span>
        </div>
      ))}
    </div>
  )
}
