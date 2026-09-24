/**
 * Verification levels (Trust & Verification, Sprint 1).
 *
 * Per-trade level comes straight from trades.source:
 *   manual    → Self-reported   (user-typed, editable)
 *   statement → Statement imported (MT5 file upload, execution fields locked)
 *   broker    → Broker connected  (MetaApi live sync, execution fields locked)
 *
 * Profile-level status also folds in the broker_accounts connection state:
 *   pending → Verification pending, error → Verification failed.
 */

export type TradeSource = 'manual' | 'statement' | 'broker'

export type VerificationLevel =
  | 'self_reported'
  | 'statement_imported'
  | 'broker_connected'
  | 'verification_pending'
  | 'verification_failed'

export const VERIFICATION_LABELS: Record<VerificationLevel, string> = {
  self_reported: 'Self-reported',
  statement_imported: 'Statement imported',
  broker_connected: 'Broker connected',
  verification_pending: 'Verification pending',
  verification_failed: 'Verification failed',
}

/** Short label for tight UI (trade rows, leaderboard chips). */
export const VERIFICATION_SHORT: Record<VerificationLevel, string> = {
  self_reported: 'Self-reported',
  statement_imported: 'Statement',
  broker_connected: 'Broker',
  verification_pending: 'Pending',
  verification_failed: 'Failed',
}

export function tradeLevel(source: TradeSource | null | undefined): VerificationLevel {
  if (source === 'broker') return 'broker_connected'
  if (source === 'statement') return 'statement_imported'
  return 'self_reported'
}

/**
 * `disconnected` is the RETIRED state: a connection that once existed and has
 * been stood down deliberately. It is the one status the sync routes do not
 * pick up (see SYNCING_BROKER_STATUSES), which is what makes it a retirement
 * rather than a pause.
 *
 * A user-initiated disconnect does not produce it — disconnectBroker() deletes
 * the row and the MetaApi account outright. This is for a connection we retire
 * on our side and want to keep a record of: an internal/seed account, or one
 * whose upstream is gone.
 */
export type BrokerStatus = 'pending' | 'active' | 'error' | 'disconnected' | null

/** The statuses the hourly sync acts on. `disconnected` is deliberately absent,
 *  and the routes share this list so that adding a status cannot silently put
 *  retired accounts back into the cycle. */
export const SYNCING_BROKER_STATUSES: Exclude<BrokerStatus, null | 'disconnected'>[] =
  ['pending', 'active', 'error']

export type SourceCounts = { manual: number; statement: number; broker: number }

/**
 * Profile-level verification: the strongest evidence wins, but a broker
 * connection that is pending/failed surfaces as such.
 *
 * A RETIRED connection claims nothing by itself and must not read as failed:
 * `error` outranks the trade counts (a broken connection is worth saying out
 * loud), but a retirement is not a fault, so it falls through to whatever the
 * trades already prove. That ordering is why /TheTradingSocial spent
 * 2026-09-14 to 09-24 titled "trading track record" with a Failed chip while
 * thirteen statement-imported trades sat underneath it: the account was
 * stuck in `error` behind a MetaApi connection that had never once imported a
 * trade. Trades that DID arrive from a broker stay broker-verified after the
 * connection goes away — the evidence is in the trade, not in the link.
 */
export function profileLevel(counts: SourceCounts, brokerStatus: BrokerStatus): VerificationLevel {
  if (brokerStatus === 'pending') return 'verification_pending'
  if (brokerStatus === 'error') return 'verification_failed'
  if (brokerStatus === 'active' || counts.broker > 0) return 'broker_connected'
  if (counts.statement > 0) return 'statement_imported'
  return 'self_reported'
}

/** Verification confidence: percentage mix by source (sums to 100 when trades exist). */
export function sourceMix(counts: SourceCounts): { manual: number; statement: number; broker: number } {
  const total = counts.manual + counts.statement + counts.broker
  if (total === 0) return { manual: 0, statement: 0, broker: 0 }
  const pct = (n: number) => Math.round((n / total) * 100)
  return { manual: pct(counts.manual), statement: pct(counts.statement), broker: pct(counts.broker) }
}

/** Account-type labels (live / demo / prop / competition). */
export type AccountType = 'live' | 'demo' | 'prop' | 'competition'

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  live: 'Live account',
  demo: 'Demo account',
  prop: 'Prop-firm account',
  competition: 'Competition account',
}

export const ACCOUNT_TYPE_SHORT: Record<AccountType, string> = {
  live: 'Live',
  demo: 'Demo',
  prop: 'Prop',
  competition: 'Comp',
}

/**
 * Search-result wording for a profile (SEO audit 2026-09-18, D6).
 *
 * Every public profile used to be titled "verified trading track record",
 * including ones whose trades were all typed in by hand. The page itself has
 * always been precise — it shows the per-source mix and counts only
 * statement/broker trades as verified days — so the metadata now follows the
 * same rule instead of making one flat claim for everyone.
 *
 * Pending and failed connections read as unverified on purpose: nothing is
 * verified until trades actually arrive from the broker.
 */
export function profileRecordLabel(level: VerificationLevel): string {
  if (level === 'broker_connected') return 'broker-verified trading track record'
  if (level === 'statement_imported') return 'statement-verified trading track record'
  return 'trading track record'
}

/** How the trades behind the numbers reached the journal. */
export function profileSourcePhrase(level: VerificationLevel): string {
  if (level === 'broker_connected') return 'broker-synced trades'
  if (level === 'statement_imported') return 'imported broker statements'
  return 'self-reported trades'
}
