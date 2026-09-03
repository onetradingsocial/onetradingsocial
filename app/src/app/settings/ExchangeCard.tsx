'use client'

import { useActionState, useState, useTransition } from 'react'
import { connectExchange, disconnectExchange, syncNow, type ExchangeState } from '@/app/actions/exchange'
import { Icon } from '@/app/[username]/_components/Icon'
import { PrivacyNote } from '@/app/_components/LegalNotice'
import Link from 'next/link'

export type ExchangeRowView = {
  status: string; symbols: string[]
  last_sync_at: string | null; sync_error: string | null
}

const MAJORS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'BNB/USDT', 'DOGE/USDT', 'ADA/USDT']

export function ExchangeCard({ row, canImport }: { row: ExchangeRowView | null; canImport: boolean }) {
  const [state, formAction, pending] = useActionState<ExchangeState, FormData>(connectExchange, {})
  const [picked, setPicked] = useState<Set<string>>(new Set(MAJORS.slice(0, 3)))
  const [extra, setExtra] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [discErr, setDiscErr] = useState('')
  const [discPending, startDisc] = useTransition()
  const [syncing, startSync] = useTransition()
  const [syncMsg, setSyncMsg] = useState('')

  if (!canImport) {
    return (
      <section id="exchange" className="ts-card settings-section">
        <h2 className="ts-h2"><Icon name="bolt" size={18} /> Crypto exchange sync</h2>
        <p className="ts-sub mt-2">Connect Binance with a read-only API key and your trades land in the journal. Available on the Pro plan.</p>
        <Link href="/settings/billing" className="btn btn-primary mt-4">Upgrade to Pro</Link>
      </section>
    )
  }

  if (row) {
    const synced = row.last_sync_at ? new Date(row.last_sync_at).toLocaleString() : 'not yet'
    return (
      <section id="exchange" className="ts-card settings-section">
        <h2 className="ts-h2"><Icon name="bolt" size={18} /> Crypto exchange sync</h2>
        <p className="ts-sub mt-2">
          <strong>Binance</strong>{' · '}status: {row.status}{' · '}last synced: {synced}
        </p>
        <p className="faint mt-1" style={{ fontSize: 12 }}>Pairs: {row.symbols.join(', ') || '—'}</p>
        {row.sync_error && <p className="ts-error mt-2">{row.sync_error}</p>}
        {syncMsg && <p className="ts-sub mt-2">{syncMsg}</p>}
        {discErr && <p className="ts-error mt-2">{discErr}</p>}
        <div className="mt-4" style={{ display: 'flex', gap: 8 }}>
          <button
            type="button" className="btn btn-primary" disabled={syncing}
            onClick={() => startSync(async () => {
              setSyncMsg('')
              const r = await syncNow()
              setSyncMsg(r.error ? '' : `Imported ${r.imported} trade${r.imported === 1 ? '' : 's'}.`)
              if (r.error) setDiscErr(r.error)
            })}
          >{syncing ? 'Syncing…' : 'Sync now'}</button>
          {confirming ? (
            <>
              <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={discPending}>Cancel</button>
              <button
                type="button" className="btn" disabled={discPending}
                onClick={() => startDisc(async () => {
                  const r = await disconnectExchange()
                  if (r.error) { setDiscErr(r.error); setConfirming(false) }
                })}
              >{discPending ? 'Disconnecting…' : 'Yes, disconnect'}</button>
            </>
          ) : (
            <button type="button" className="btn" onClick={() => setConfirming(true)}>Disconnect</button>
          )}
        </div>
      </section>
    )
  }

  const symbols = [...picked, ...extra.split(',').map((s) => s.trim()).filter(Boolean)].join(',')
  return (
    <section id="exchange" className="ts-card settings-section">
      <h2 className="ts-h2"><Icon name="bolt" size={18} /> Crypto exchange sync</h2>
      <p className="ts-sub mt-2">
        Paste a <strong>read-only</strong> Binance API key (enable “Reading” only — not trading or withdrawals).
        We store it encrypted and it can never move funds.
      </p>
      {/* APP 5, audit item 4 S9. The copy above was already specific and true;
          what was missing was the recipient, the algorithm and the one thing
          only the user can do. secrets.ts encrypts with AES-256-GCM under a key
          held in the server environment; crypto-sync/route.ts pins the calling
          function to sin1 (Singapore); account deletion removes our encrypted
          copy but cannot revoke the key at Binance. */}
      <p className="ts-sub mt-2">
        We encrypt the key and secret with <strong>AES-256-GCM</strong> before storing them and never
        display them back to you. They are used from a server in Singapore to read your fills from
        Binance. Deleting your account deletes our copy — <strong>only you can revoke the key at
        Binance</strong>, so do that as well.
      </p>
      <PrivacyNote>What Binance receives, and where, is in section 8 of our privacy policy.</PrivacyNote>
      <details className="ts-help mt-2" style={{ fontSize: 13 }}>
        <summary style={{ cursor: 'pointer', color: 'var(--accent, #4f8cff)' }}>
          How do I get a read-only key?
        </summary>
        <ol className="faint" style={{ margin: '8px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>
          <li>On Binance: <strong>Account → API Management</strong> → <strong>Create API</strong> (System generated).</li>
          <li>Label it, then complete Binance’s security check.</li>
          <li>Tick <strong>Enable Reading only</strong> — leave Spot/Margin/Futures trading and Withdrawals off.</li>
          <li>Copy the <strong>API Key</strong> and <strong>Secret</strong> (the secret shows once) and paste them below.</li>
          <li>Pick the pairs you trade, then Connect.</li>
        </ol>
      </details>
      <form action={formAction} className="mt-4">
        <input type="hidden" name="symbols" value={symbols} />
        <label className="ts-field"><span className="ts-label">API key</span>
          <input name="apiKey" className="ts-input" autoComplete="off" required /></label>
        <label className="ts-field mt-3"><span className="ts-label">API secret</span>
          <input name="apiSecret" type="password" className="ts-input" autoComplete="off" required /></label>
        <div className="ts-field mt-3">
          <span className="ts-label">Pairs to sync</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
            {MAJORS.map((p) => (
              <label key={p} style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 13 }}>
                <input
                  type="checkbox" checked={picked.has(p)}
                  onChange={(e) => {
                    const next = new Set(picked)
                    if (e.target.checked) next.add(p); else next.delete(p)
                    setPicked(next)
                  }}
                />{p}
              </label>
            ))}
          </div>
          <input
            className="ts-input mt-2" placeholder="Add more, comma-separated (e.g. LINK/USDT, AVAX/USDT)"
            value={extra} onChange={(e) => setExtra(e.target.value)}
          />
        </div>
        {state.error && <p className="ts-error mt-3">{state.error}</p>}
        <button className="btn btn-primary mt-4" disabled={pending}>{pending ? 'Connecting…' : 'Connect Binance'}</button>
      </form>
    </section>
  )
}
