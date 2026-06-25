'use client'
import { useState } from 'react'

async function post(url: string, body?: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) { alert('Something went wrong. Please try again.'); return }
  const { url: redirect } = await res.json()
  if (redirect) window.location.href = redirect
}

export function UpgradeButtons() {
  const [interval, setInterval] = useState<'monthly' | 'annual'>('monthly')
  const [busy, setBusy] = useState(false)
  const go = async (tier: 'trader' | 'pro') => {
    setBusy(true)
    await post('/api/billing/checkout', { tier, interval })
    setBusy(false)
  }
  return (
    <div className="grid gap-4">
      <div className="ts-billing-toggle">
        <button type="button" className={interval === 'monthly' ? 'active' : ''} onClick={() => setInterval('monthly')}>Monthly</button>
        <button type="button" className={interval === 'annual' ? 'active' : ''} onClick={() => setInterval('annual')}>Annual (2 months free)</button>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <button className="btn btn-primary" disabled={busy} onClick={() => go('trader')}>
          Upgrade to Trader — {interval === 'monthly' ? '$30/mo' : '$300/yr'}
        </button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => go('pro')}>
          Go Pro — {interval === 'monthly' ? '$50/mo' : '$500/yr'}
        </button>
      </div>
    </div>
  )
}

export function ManageButton() {
  const [busy, setBusy] = useState(false)
  return (
    <button className="btn btn-ghost" disabled={busy}
      onClick={async () => { setBusy(true); await post('/api/billing/portal'); setBusy(false) }}>
      Manage billing
    </button>
  )
}
