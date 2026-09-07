'use client'

import { useActionState, useEffect, useRef, useState, useTransition } from 'react'
import { connectBroker, disconnectBroker, type BrokerState } from '@/app/actions/broker'
import { Icon } from '@/app/[username]/_components/Icon'
import { PrivacyNote } from '@/app/_components/LegalNotice'
import { track } from '@/lib/track'
import Link from 'next/link'

export type BrokerRow = {
  login: string; server: string; status: string
  last_sync_at: string | null; sync_error: string | null
}

/**
 * Fires `broker_card_seen` the first time the card is actually in the viewport.
 *
 * `broker_card_viewed` is emitted during the server render of /settings, so it
 * counts everyone who reached the page. That was fine as a denominator and
 * wrong as the thing its name claims: the card sits ~3,300px down a single
 * scrolling page, and until the fragment scroll landed (HashScroll) even the two
 * signposts built to deliver users to it left them at the top. Every arrival was
 * recorded as a view, so "never saw it" and "saw it and walked away" — the exact
 * pair the event exists to separate — stayed indistinguishable.
 *
 * The two events answer different questions and both are kept:
 *
 *   viewed - seen  = reached settings, never scrolled to the card
 *   seen - submitted = read the card and declined
 *
 * `viewed` stays server-side because it is the reliable one: it survives
 * ad-blockers (ERR_BLOCKED_BY_CLIENT is observable on production today) and
 * declined analytics consent, both of which drop `seen`. So `seen` is a floor,
 * never a denominator — a gap between the two is partly people who did not
 * scroll and partly people whose beacon never left the browser.
 *
 * Fires once per page load, matching `viewed`: repeat views without a submit are
 * themselves the signal, so neither event is deduped per user.
 */
function useBrokerCardSeen(gated: boolean, connected: boolean, tier: string, from: string) {
  const ref = useRef<HTMLElement | null>(null)
  const fired = useRef(false)

  useEffect(() => {
    const node = ref.current
    if (!node || fired.current) return
    // Half the card, not a sliver at the edge of the fold: the section is a
    // heading, a line of copy and one control, so 0.5 is reached as soon as it
    // is genuinely on screen at any viewport width.
    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.intersectionRatio >= 0.5)) return
        fired.current = true
        track('broker_card_seen', { gated, connected, tier, from })
        obs.disconnect()
      },
      { threshold: 0.5 },
    )
    obs.observe(node)
    return () => obs.disconnect()
  }, [gated, connected, tier, from])

  return ref
}

export function BrokerCard({ row, canAutosync, tier, from }: {
  row: BrokerRow | null; canAutosync: boolean; tier: string; from: string
}) {
  const seenRef = useBrokerCardSeen(!canAutosync, !!row, tier, from)
  const [state, formAction, pending] = useActionState<BrokerState, FormData>(connectBroker, {})
  const [confirming, setConfirming] = useState(false)
  const [discErr, setDiscErr] = useState('')
  const [discPending, startDisc] = useTransition()

  if (!canAutosync) {
    return (
      <section id="broker" ref={seenRef} className="ts-card settings-section">
        <h2 className="ts-h2"><Icon name="bolt" size={18} /> MT5 auto-sync</h2>
        <p className="ts-sub mt-2">Connect your MT5 account and your closed trades land in the journal automatically, every hour.</p>
        <Link href="/settings/billing" className="btn btn-primary mt-4">Upgrade to Pro</Link>
      </section>
    )
  }

  if (row) {
    const synced = row.last_sync_at ? new Date(row.last_sync_at).toLocaleString() : 'not yet — first sync within the hour'
    return (
      <section id="broker" ref={seenRef} className="ts-card settings-section">
        <h2 className="ts-h2"><Icon name="bolt" size={18} /> MT5 auto-sync</h2>
        <p className="ts-sub mt-2">
          Account <strong>{row.login}</strong> on <strong>{row.server}</strong>
          {' · '}status: {row.status}{' · '}last synced: {synced}
        </p>
        <p className="faint mt-1" style={{ fontSize: 12 }}>Syncs hourly — closed trades appear in your journal automatically.</p>
        {row.sync_error && <p className="ts-error mt-2">{row.sync_error}</p>}
        {discErr && <p className="ts-error mt-2">{discErr}</p>}
        {confirming ? (
          <div className="mt-4" style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={discPending}>Cancel</button>
            <button
              type="button" className="btn btn-primary" disabled={discPending}
              onClick={() => startDisc(async () => {
                const r = await disconnectBroker()
                if (r.error) { setDiscErr(r.error); setConfirming(false) }
              })}
            >{discPending ? 'Disconnecting…' : 'Yes, disconnect'}</button>
          </div>
        ) : (
          <button type="button" className="btn mt-4" onClick={() => setConfirming(true)}>Disconnect</button>
        )}
      </section>
    )
  }

  return (
    <section id="broker" ref={seenRef} className="ts-card settings-section">
      <h2 className="ts-h2"><Icon name="bolt" size={18} /> MT5 auto-sync</h2>
      {/* APP 5.2(f)-(i), audit item 4 finding 4 / S1. The previous copy said the
          password went to "the sync service" and stopped there: it never named
          MetaApi, never said the recipient was a third party, and never said the
          credential leaves Australia. This is the highest-consequence collection
          on the platform — a live broker credential — so the recipient, the
          country and the removal path are all named at the point of entry.
          Every clause below is verifiable: metaapi.ts:49-58 posts login,
          password and server to MetaApi and reads back a region defaulting to
          'london'; 0019_broker_accounts.sql stores no password column;
          actions/broker.ts:57-58 calls undeployAccount + removeAccount on
          disconnect, and lib/server/account-deletion.ts does the same on account
          deletion. */}
      <p className="ts-sub mt-2">
        Connect with your <strong>read-only investor password</strong>. It can view the account but
        cannot place trades or move funds.
      </p>
      <p className="ts-sub mt-2">
        We never store it. We pass it once to <strong>MetaApi</strong>, a third-party service in the
        United States that runs the sync for us and holds the password to keep your account
        connected. MetaApi hosts connected accounts on a node that defaults to the{' '}
        <strong>United Kingdom</strong>, so <strong>your broker login is held outside Australia</strong>.
        Disconnecting here removes it from MetaApi, and so does deleting your account.
      </p>
      <PrivacyNote>Overseas transfers, and what MetaApi receives, are set out in section 8 of our privacy policy.</PrivacyNote>
      <form action={formAction} className="mt-4">
        <label className="ts-field"><span className="ts-label">MT5 account number</span>
          <input name="login" className="ts-input" inputMode="numeric" placeholder="12345678" required /></label>
        <label className="ts-field mt-3"><span className="ts-label">Investor password (read-only)</span>
          <input name="password" type="password" className="ts-input" autoComplete="off" required /></label>
        <label className="ts-field mt-3"><span className="ts-label">Broker server</span>
          <input name="server" className="ts-input" placeholder="ICMarketsSC-Live" required /></label>
        {state.error && <p className="ts-error mt-3">{state.error}</p>}
        <button className="btn btn-primary mt-4" disabled={pending}>{pending ? 'Connecting…' : 'Connect account'}</button>
      </form>
    </section>
  )
}
