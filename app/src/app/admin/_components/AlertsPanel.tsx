'use client'

import { useTransition } from 'react'
import { ackSystemAlert } from '@/app/actions/admin'

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
    <div className="ts-card" style={{ gridColumn: '1 / -1', borderColor: 'rgba(229,71,93,0.4)' }}>
      <span className="faint" style={{ fontSize: 13 }}>⚠ Open alerts</span>
      <div className="mt-3" style={{ display: 'grid', gap: 8 }}>
        {alerts.map((a) => (
          <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 14 }}>
              <code style={{ fontSize: 12, marginRight: 8 }}>{a.kind}</code>
              {a.message}
              <span className="faint" style={{ fontSize: 12, marginLeft: 8 }}>
                {new Date(a.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            </span>
            <button
              type="button" className="btn" disabled={pending}
              onClick={() => start(async () => { await ackSystemAlert(a.id) })}
            >
              Acknowledge
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
