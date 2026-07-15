import Link from 'next/link'
import {
  VERIFICATION_LABELS, VERIFICATION_SHORT, ACCOUNT_TYPE_SHORT, ACCOUNT_TYPE_LABELS,
  type VerificationLevel, type AccountType,
} from '@/lib/verification'

const LEVEL_CLASS: Record<VerificationLevel, string> = {
  self_reported: 'vb-self',
  statement_imported: 'vb-statement',
  broker_connected: 'vb-broker',
  verification_pending: 'vb-pending',
  verification_failed: 'vb-failed',
}

/**
 * Verification status chip. Links to /verification (methodology page) so every
 * badge doubles as an explainer, per the trust spec.
 */
export function VerificationBadge({
  level, short = false, linked = true,
}: { level: VerificationLevel; short?: boolean; linked?: boolean }) {
  const label = short ? VERIFICATION_SHORT[level] : VERIFICATION_LABELS[level]
  const chip = (
    <span className={`v-badge ${LEVEL_CLASS[level]}`} title={VERIFICATION_LABELS[level]}>
      {level === 'broker_connected' && (
        <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
          <path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {label}
    </span>
  )
  if (!linked) return chip
  return <Link href="/verification" className="v-badge-link" prefetch={false}>{chip}</Link>
}

/** Account-type chip (live / demo / prop / competition). Null = not declared. */
export function AccountTypeBadge({ type, short = true }: { type: AccountType | null; short?: boolean }) {
  if (!type) return null
  return (
    <span className={`v-badge at-${type}`} title={ACCOUNT_TYPE_LABELS[type]}>
      {short ? ACCOUNT_TYPE_SHORT[type] : ACCOUNT_TYPE_LABELS[type]}
    </span>
  )
}
