'use client'

import { useState, useTransition } from 'react'
import { saveNotificationPrefs } from '@/app/actions/notifications'

const PREFS: [string, string][] = [
  ['weekly_report', 'Weekly review ready'],
  ['import_done', 'Trade import completed'],
  ['sync_failed', 'Broker sync failed'],
  ['goal_completed', 'Process goal completed'],
  ['rule_breach', 'Rule breach on a trade'],
  ['new_learning', 'New learning material'],
  ['follow', 'New follower'],
  ['comment', 'Comments & replies'],
  ['mention', 'Mentions'],
]

/** Granular notification preferences (Sprint 4, row 31). Absent key = on. */
export function NotificationPrefs({ initial }: { initial: Record<string, boolean> }) {
  const [prefs, setPrefs] = useState<Record<string, boolean>>(initial)
  const [pending, start] = useTransition()
  const [saved, setSaved] = useState(false)

  function toggle(key: string) {
    const next = { ...prefs, [key]: prefs[key] === false ? true : false }
    setPrefs(next)
    setSaved(false)
    start(async () => { await saveNotificationPrefs(next); setSaved(true) })
  }

  return (
    <section id="notifications" className="ts-card settings-section">
      <h2 className="ts-h2">Notifications</h2>
      <p className="ts-sub mb-4">Choose what shows up in your notification bell. {saved && <span className="settings-saved">Saved.</span>}</p>
      <div style={{ display: 'grid', gap: 8 }}>
        {PREFS.map(([key, label]) => (
          <label key={key} className="ts-chip" style={{ justifyContent: 'space-between', display: 'flex', alignItems: 'center' }}>
            <span>{label}</span>
            <input type="checkbox" checked={prefs[key] !== false} disabled={pending} onChange={() => toggle(key)} />
          </label>
        ))}
      </div>
    </section>
  )
}
