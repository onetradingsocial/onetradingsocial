import Link from 'next/link'
import { lastSyncPhrase, type BrokerSyncNotice } from '@/lib/broker-sync-notice'

/**
 * The journal's word on a stopped MT5 sync. See lib/broker-sync-notice.ts for
 * why this exists and when it shows. Server-rendered: it states a fact the page
 * already knows, and needs no interaction beyond the link.
 */
export function BrokerSyncBanner({ notice, now }: { notice: BrokerSyncNotice; now: number }) {
  const since = lastSyncPhrase(notice.lastSyncAt, now)
  const linkStyle = { color: 'var(--violet-br)', fontWeight: 700 } as const

  if (notice.kind === 'paused') {
    return (
      <div className="ts-banner ts-banner--warn mt-5" role="status">
        <span>⏸️ <b>MT5 auto-sync is paused</b> — your plan no longer includes it, so new trades
          {since ? <> since the last sync ({since})</> : null} aren&apos;t reaching your journal.
          Everything already imported is safe.{' '}
          <Link href="/settings/billing" style={linkStyle}>Upgrade to resume</Link></span>
      </div>
    )
  }

  return (
    <div className="ts-banner ts-banner--warn mt-5" role="alert">
      <span>⚠️ <b>Your MT5 sync has stopped working</b>
        {since ? <> — last successful sync {since}</> : null}. New trades aren&apos;t reaching
        your journal until it&apos;s reconnected.{' '}
        <Link href="/settings#broker" style={linkStyle}>Check your connection</Link></span>
    </div>
  )
}
