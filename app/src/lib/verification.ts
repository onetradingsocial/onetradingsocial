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

export type BrokerStatus = 'pending' | 'active' | 'error' | 'disconnected' | null

export type SourceCounts = { manual: number; statement: number; broker: number }

/**
 * Profile-level verification: the strongest evidence wins, but a broker
 * connection that is pending/failed surfaces as such.
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
