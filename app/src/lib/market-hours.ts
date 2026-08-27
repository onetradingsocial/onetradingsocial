/**
 * Forex market hours, in UTC.
 *
 * WHY THIS EXISTS — it is a billing control, not a correctness one.
 *
 * MetaApi charges a flat fee every time an account is DEPLOYED (started), on
 * top of an hourly rate while it runs. The sync used to deploy at :00 and
 * undeploy at :10, every hour — 720 starts per month per account. At the
 * published G2 rate that is ~US$51.84/month in start-up fees alone, against
 * ~US$8.64 for simply leaving the account running for the whole month. The
 * "optimisation" cost about six times what it saved.
 *
 * So accounts now stay deployed, and the only thing worth switching off is the
 * weekend: forex is closed from Friday 22:00 UTC to Sunday 22:00 UTC, roughly
 * 48 hours in which no deal can be created and therefore nothing can be synced.
 * Undeploying across it costs one start fee a week and saves ~28% of hourly
 * hosting.
 *
 * The boundaries are deliberately the conservative ones. Brokers differ by an
 * hour or two either side (and DST shifts them), so being an hour late to
 * reopen risks nothing but a delayed sync, while being an hour early to close
 * could drop a deal. When in doubt this errs toward being deployed.
 */

/** Friday close, UTC hour. Market shuts ~21:00-22:00 depending on broker/DST. */
const FRIDAY_CLOSE_UTC_HOUR = 22

/** Sunday open, UTC hour. Sydney opens ~21:00-22:00 depending on DST. */
const SUNDAY_OPEN_UTC_HOUR = 22

/**
 * Is the forex market open at `now`?
 *
 * Open: Sunday 22:00 UTC through Friday 22:00 UTC.
 * Closed: Friday 22:00 UTC through Sunday 22:00 UTC.
 */
export function isForexOpen(now: Date): boolean {
  const day = now.getUTCDay() // 0 = Sunday
  const hour = now.getUTCHours()

  switch (day) {
    case 6: // Saturday — closed all day
      return false
    case 0: // Sunday — opens in the evening
      return hour >= SUNDAY_OPEN_UTC_HOUR
    case 5: // Friday — closes in the evening
      return hour < FRIDAY_CLOSE_UTC_HOUR
    default: // Monday-Thursday
      return true
  }
}
