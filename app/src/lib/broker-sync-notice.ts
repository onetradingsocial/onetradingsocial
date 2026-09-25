/**
 * What the journal should say about the user's MT5 connection, if anything.
 *
 * The journal is where a broker user looks, and it is the one page that said
 * nothing when their sync stopped. The failure was surfaced in three places the
 * user does not visit: the bell (15 unread system notices on the one real
 * broker account, 2026-09-02 to 09-18), the `sync_error` line on /settings, and
 * nowhere in email. From the journal a dead sync and a quiet market look
 * identical — the trade list simply stops growing.
 *
 * Two notices, kept apart because they ask for different things:
 *
 *   paused  — the plan no longer includes auto-sync. Nothing is broken; the
 *             collect route skips the account and undeploys it. The fix is the
 *             plan, so the link goes to billing.
 *   failed  — the plan includes auto-sync and the connection is in `error`. The
 *             fix is the connection, so the link goes to the broker card.
 *
 * `paused` is decided from the entitlement, not from `sync_error` text: the
 * collect and deploy routes write the "Pro plan required" message in slightly
 * different words, and a notice keyed on a string would break the day either is
 * reworded.
 *
 * A single failed cycle is not shown. `collect` marks an account `error` on any
 * failure, including a 15s MetaApi timeout that the next hour's run clears, so a
 * notice on `status === 'error'` alone would flash "your sync stopped" for a
 * blip. It waits until the last good sync is older than FAILED_GRACE_MS.
 */

export type BrokerSyncRow = {
  status: string | null
  last_sync_at: string | null
}

export type BrokerSyncNotice =
  | { kind: 'paused'; lastSyncAt: string | null }
  | { kind: 'failed'; lastSyncAt: string | null }

/** Three hourly cycles. Long enough to ride out a timeout or a late GitHub
 *  dispatch; short enough that a real outage is on the journal the same day. */
export const FAILED_GRACE_MS = 3 * 60 * 60 * 1000

export function brokerSyncNotice(
  row: BrokerSyncRow | null,
  canAutosync: boolean,
  now: number,
): BrokerSyncNotice | null {
  // No connection, or one we retired on purpose: nothing to report.
  if (!row || row.status === 'disconnected') return null

  if (!canAutosync) return { kind: 'paused', lastSyncAt: row.last_sync_at }

  if (row.status !== 'error') return null
  const last = row.last_sync_at ? Date.parse(row.last_sync_at) : NaN
  if (Number.isFinite(last) && now - last < FAILED_GRACE_MS) return null
  return { kind: 'failed', lastSyncAt: row.last_sync_at }
}

/**
 * "today", "yesterday", "5 days ago". Relative on purpose: this renders in a
 * Server Component, which formats in UTC by design, and a relative day count is
 * right in every timezone to within the day boundary — an absolute timestamp
 * would be wrong by the viewer's offset.
 */
export function lastSyncPhrase(lastSyncAt: string | null, now: number): string | null {
  if (!lastSyncAt) return null
  const t = Date.parse(lastSyncAt)
  if (!Number.isFinite(t)) return null
  const days = Math.floor((now - t) / (24 * 60 * 60 * 1000))
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}
