/**
 * Inactivity recovery — who gets nudged, how often, and when to stop.
 *
 * The original rules capped eligibility by account age (`ageDays <= 30`) and by
 * time since the last trade (`<= 30 * DAY`). Those caps read as throttling but
 * functioned as permanent exclusion: a user who signed up, never logged a
 * trade, and crossed day 30 could never match any condition again, and neither
 * could anyone whose last trade aged past a month. Measured against production,
 * that was 24 of 40 users — 60% of the base was permanently unreachable by the
 * one system whose job is reaching lapsed users.
 *
 * Removing the caps outright would be the opposite error: a 7-day throttle with
 * no end means nudging someone weekly, forever, about a product they left.
 *
 * So contact decays instead of stopping dead. The longer someone has been
 * lapsed, the wider the gap before the next nudge, until we stop entirely at
 * six months. Roughly six contacts over that period, front-loaded to when
 * they're most likely to come back.
 */

/** Days a lapsed user is left alone before the next nudge. Null means stop. */
export function recoveryGapDays(lapsedDays: number): number | null {
  if (lapsedDays < 30) return 7    // recently lapsed — weekly, as before
  if (lapsedDays < 90) return 21   // a month or two out — every three weeks
  if (lapsedDays < 180) return 45  // fading — every six weeks
  return null                      // six months gone; stop rather than nag
}

/** Don't nudge a brand-new account before it has had a fair chance. */
const MIN_ACCOUNT_AGE_DAYS = 2
/** A user with trades isn't lapsed until they've been quiet this long. */
const QUIET_DAYS = 7
/** Past this, we stop contacting entirely. */
export const RECOVERY_STOP_DAYS = 180

/** Plain-language elapsed time. The old copy said "over a week" to everyone,
 *  which reads as broken automation to someone four months gone. */
export function sinceLabel(days: number): string {
  if (days < 14) return 'over a week'
  if (days < 31) return 'a couple of weeks'
  if (days < 62) return 'over a month'
  if (days < 150) return 'a few months'
  return 'a long time'
}

export type RecoveryNudge = { reason: string; cta: string; href: string }

export type RecoveryInput = {
  tradeCount: number
  daysSinceSignup: number
  /** Null when they have never logged a trade. */
  daysSinceLastTrade: number | null
}

/**
 * The nudge a user should receive right now, or null if none applies.
 *
 * "Lapsed" is measured from the last trade for anyone who has traded, and from
 * signup for anyone who never has — otherwise a user with no trades has no
 * clock at all, which is how they used to fall out of scope permanently.
 */
export function recoveryNudge(o: RecoveryInput): RecoveryNudge | null {
  const neverTraded = o.tradeCount === 0
  const lapsedDays = neverTraded ? o.daysSinceSignup : o.daysSinceLastTrade
  if (lapsedDays == null) return null

  if (neverTraded && o.daysSinceSignup < MIN_ACCOUNT_AGE_DAYS) return null
  if (!neverTraded && (o.daysSinceLastTrade ?? 0) < QUIET_DAYS) return null
  if (lapsedDays >= RECOVERY_STOP_DAYS) return null

  const label = sinceLabel(lapsedDays)

  if (neverTraded) {
    return {
      reason: `You signed up ${label} ago and haven't logged a trade yet. It takes under a minute — and your stats start building from the first one.`,
      cta: 'Log your first trade',
      href: '/journal',
    }
  }
  if (o.tradeCount === 1) {
    return {
      reason: `You logged one trade and then went quiet. One trade isn't a track record — log a few more and the patterns start showing up.`,
      cta: 'Log another trade',
      href: '/journal',
    }
  }
  return {
    reason: `It's been ${label} since your last logged trade. Your journal is where you left it — ${o.tradeCount} trades in.`,
    cta: 'Back to your journal',
    href: '/journal',
  }
}

/** Whether the throttle has opened for this user yet. */
export function recoveryDue(o: {
  lapsedDays: number
  daysSinceLastRecoveryEmail: number | null
}): boolean {
  const gap = recoveryGapDays(o.lapsedDays)
  if (gap == null) return false
  return o.daysSinceLastRecoveryEmail == null || o.daysSinceLastRecoveryEmail >= gap
}
