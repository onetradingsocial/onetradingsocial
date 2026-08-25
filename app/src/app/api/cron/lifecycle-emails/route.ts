import { NextResponse } from 'next/server'
import { authorizedCron } from '@/lib/cron'
import { createServiceClient } from '@/lib/supabase/service'
import { sendEmail, weeklyDigestHtml, recoveryHtml, trialExpiredHtml } from '@/lib/server/email'
import { insertSystemNotification } from '@/lib/notifications'
import { computeMetrics, isClosed, rValues, type TradeForMetrics } from '@/lib/trade'
import { recoveryDue, recoveryNudge } from '@/lib/recovery'
import { generateInsights } from '@/lib/insights'
import { trialState, JOURNAL_FREE_LIMIT } from '@/lib/entitlements'
import { getStripe } from '@/lib/stripe'
import { reconcileBilling } from '@/lib/server/billing-reconcile'
import { logError, logWarn } from '@/lib/server/log'

export const maxDuration = 60

const DAY = 864e5

/** How recently a trial must have lapsed for us to email about it.
 *
 *  This is a "your trial has ended" notice, and it stops being a notice once
 *  enough time has passed — mailing someone about a trial that ran out six
 *  weeks ago reads as a system that has just woken up, which it has. The
 *  window also protects the first run after deploy: 34 trials had already
 *  expired unacknowledged in production when this was written, and blasting
 *  all of them at once would be a spike of confusing mail, not a fix. They get
 *  nothing by design; widen this constant temporarily if a deliberate backfill
 *  is wanted. */
const TRIAL_EXPIRY_NOTICE_WINDOW_DAYS = 7

/**
 * Daily lifecycle emails (Sprint 4, rows 32 + 33) — one route because Vercel
 * Hobby caps cron jobs. Weekly digests go out ~weekly per user (throttled by
 * last_weekly_email); inactivity nudges are throttled by last_recovery_email.
 * With no email provider configured it falls back to in-app notifications.
 */
export async function GET(req: Request) {
  if (!authorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const svc = createServiceClient()
  const now = Date.now()

  // ---- Billing reconciliation ------------------------------------------------
  // Piggy-backed here rather than given its own vercel.json entry because the
  // Hobby plan caps cron jobs at two and both are taken — the same constraint
  // that put the weekly digest and the inactivity nudge in one route. The
  // standalone endpoint at /api/cron/billing-reconcile still exists for manual
  // runs and for the day this project moves to Pro.
  //
  // Strictly best-effort and first, so it gets the fresh end of the 60s budget
  // and can never be the reason the emails do not go out.
  let reconciled: unknown = 'skipped'
  try {
    reconciled = await reconcileBilling(svc, getStripe())
  } catch (err) {
    logError('lifecycle-emails', err, { note: 'billing reconcile failed' })
    reconciled = { error: err instanceof Error ? err.message : 'failed' }
  }

  const { data: users } = await svc
    .from('profiles')
    .select('id, username, display_name, created_at, last_weekly_email, last_recovery_email, notification_prefs')
    .eq('is_internal', false)
  if (!users) return NextResponse.json({ error: 'no users' }, { status: 500 })

  const emailOf = async (uid: string): Promise<string | null> => {
    const { data } = await svc.auth.admin.getUserById(uid)
    return data.user?.email ?? null
  }

  let digests = 0, nudges = 0

  /**
   * Delivery accounting.
   *
   * `sendEmail` returns `{ sent: false, error }` rather than throwing — it
   * no-ops entirely when RESEND_API_KEY is absent — and every call site here
   * used to discard that result. The counters below therefore reported
   * `digests: 12` whether twelve emails were delivered or none were, and the
   * route returned `ok: true` either way. That is the same failure shape as the
   * silently-green MT5 sync: a green signal that carries no information.
   *
   * These count what actually left the building, and the summary at the end
   * refuses to claim ok when nothing did.
   */
  let delivered = 0, undelivered = 0
  const failures = new Map<string, number>()

  const deliver = async (to: string | null, subject: string, html: string): Promise<boolean> => {
    if (!to) {
      undelivered++
      failures.set('no_address', (failures.get('no_address') ?? 0) + 1)
      return false
    }
    const res = await sendEmail({ to, subject, html })
    if (res.sent) {
      delivered++
      return true
    }
    undelivered++
    const reason = res.error ?? 'unknown'
    failures.set(reason, (failures.get(reason) ?? 0) + 1)
    return false
  }

  for (const u of users) {
    const name = u.display_name || u.username
    const prefs = (u.notification_prefs ?? {}) as Record<string, boolean>

    const { data: trades } = await svc
      .from('trades').select('r_multiple, pnl_amount, outcome, status, traded_at, setup_type, strategy_tags, mistake_tags')
      .eq('user_id', u.id).order('traded_at', { ascending: false }).limit(500)
    const rows = trades ?? []
    const lastTradeMs = rows[0] ? Date.parse(rows[0].traded_at) : null

    // ---- Weekly digest: at most every 7 days, needs ≥1 trade this week ----
    //
    // Membership is CLOSED + in-window, and nothing else. It used to also
    // require `r_multiple != null`, which is the exact trap lib/trade.ts
    // documents having already been fixed once in the journal/profile stats: a
    // stop-less quick entry carries an outcome and a P/L but no R, so gating on
    // R erases it. In production that gate was total, not partial — every
    // closed trade had a null r_multiple, so `weekTrades` was always empty and
    // this digest had never sent once to anybody. Win/loss comes from
    // `outcome`, the one field every closed trade has; only the R figure below
    // looks at r_multiple, and it skips the nulls.
    const weekAgo = now - 7 * DAY
    const dueWeekly = !u.last_weekly_email || Date.parse(u.last_weekly_email) < weekAgo
    const weekTrades = rows.filter((t) => isClosed(t) && Date.parse(t.traded_at) >= weekAgo)
    if (dueWeekly && weekTrades.length > 0 && prefs.weekly_report !== false) {
      const m = computeMetrics(weekTrades.map((t): TradeForMetrics => ({
        status: 'closed', outcome: t.outcome as TradeForMetrics['outcome'], rMultiple: t.r_multiple,
        pnlAmount: t.pnl_amount, tradedAt: t.traded_at, mistakeTags: t.mistake_tags ?? [],
      })))
      const insights = generateInsights(rows.filter((t) => t.status === 'closed').map((t) => ({
        rMultiple: t.r_multiple, pnlAmount: t.pnl_amount, tradedAt: t.traded_at,
        setupType: t.setup_type, strategyTags: t.strategy_tags ?? [], mistakeTags: t.mistake_tags ?? [],
      })))
      // Null, not zero, when nothing that week was R-denominated — see the
      // netR note on weeklyDigestHtml. `?? 0` here would have quietly asserted
      // a break-even week.
      const weekR = rValues(weekTrades.map((t) => t.r_multiple))
      const netR = weekR.length ? weekR.reduce((s, r) => s + r, 0) : null
      const mc = new Map<string, number>()
      for (const t of weekTrades) for (const mm of t.mistake_tags ?? []) mc.set(mm, (mc.get(mm) ?? 0) + 1)
      const worstMistake = [...mc.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]

      const html = weeklyDigestHtml({
        name, trades: m.total, winRate: m.winRate, netR,
        improvement: m.winRate >= 0.5 ? 'Your win rate held above 50% this week.' : 'You stayed active and logged your trades — consistency compounds.',
        mistake: worstMistake ? `You tagged "${worstMistake}" most often — worth a closer look.` : 'No recurring mistakes tagged this week.',
        insight: insights[0]?.text ?? 'Log a few more trades to unlock deeper insights.',
        action: netR == null
          ? 'Add a stop price when you log a trade — that is what turns your P/L into R, and R is what makes a week comparable to any other.'
          : netR < 0
            ? 'Review your losing trades before your next session.'
            : 'Keep doing what worked — and size consistently.',
      })
      const email = await emailOf(u.id)
      await deliver(email, 'Your weekly trading review', html)
      await insertSystemNotification({ supabase: svc, userId: u.id, type: 'weekly_report' })
      await svc.from('profiles').update({ last_weekly_email: new Date().toISOString() }).eq('id', u.id)
      digests++
      continue // don't also nudge the same user this run
    }

    // ---- Inactivity recovery ----
    //
    // Eligibility and cadence both live in lib/recovery.ts. The rules here used
    // to cap on `ageDays <= 30` and `since last trade <= 30 days`, which looked
    // like throttling but acted as permanent exclusion — 24 of 40 production
    // users matched no condition at all and never would again. Contact now
    // decays (weekly → 3-weekly → 6-weekly) and stops at six months, so lapsed
    // users stay reachable without being nagged indefinitely.
    const daysSinceSignup = (now - Date.parse(u.created_at)) / DAY
    const daysSinceLastTrade = lastTradeMs == null ? null : (now - lastTradeMs) / DAY
    const lapsedDays = rows.length === 0 ? daysSinceSignup : (daysSinceLastTrade ?? daysSinceSignup)

    if (!recoveryDue({
      lapsedDays,
      daysSinceLastRecoveryEmail: u.last_recovery_email
        ? (now - Date.parse(u.last_recovery_email)) / DAY
        : null,
    })) continue

    const nudge = recoveryNudge({
      tradeCount: rows.length,
      daysSinceSignup,
      daysSinceLastTrade,
    })

    if (nudge) {
      const { reason, cta, href } = nudge
      const email = await emailOf(u.id)
      await deliver(email, 'Your TradingSocial journal is waiting', recoveryHtml(name, reason, cta, href))
      await svc.from('profiles').update({ last_recovery_email: new Date().toISOString() }).eq('id', u.id)
      nudges++
    }
  }

  // ---- Trial expiry notice ---------------------------------------------------
  // The 14-day Pro trial used to lapse in complete silence: TRIAL_WALL_ENABLED
  // ships false, shouldShowWelcome explicitly suppresses the pro->free popup for
  // exactly this transition, and nothing here had a trial branch. In production
  // 34 trials had expired with zero acknowledgements of any kind. This is the
  // acknowledgement. It does NOT enable the wall — that is a product decision.
  //
  // Its own query, NOT folded into the select above, for the same reason
  // getEntitlements keeps welcome_tier_seen separate: last_trial_email is the
  // newest column here, and if the code deploys ahead of its migration
  // PostgREST returns 42703 for an unknown column and fails the WHOLE select it
  // belongs to. Isolated like this, a missing column can only ever disable the
  // trial notice — it can never take the weekly digests and inactivity nudges
  // down with it. It also means this branch is inert until the migration lands,
  // which is exactly the deploy order we want.
  let trialNotices = 0
  const nowDate = new Date(now)
  const { data: trials, error: trialError } = await svc
    .from('profiles')
    .select('id, username, display_name, trial_started_at, trial_ack_at, last_trial_email')
    .eq('is_internal', false)
    .not('trial_started_at', 'is', null)
    .is('last_trial_email', null)

  if (trialError) {
    logError('lifecycle-emails', trialError.message, { note: 'trial notice skipped (migration not applied?)' })
  } else {
    for (const t of trials ?? []) {
      if (trialState(t.trial_started_at, t.trial_ack_at, nowDate) !== 'expired') continue
      // Only recently lapsed trials — see TRIAL_EXPIRY_NOTICE_WINDOW_DAYS.
      const expiredAt = Date.parse(t.trial_started_at) + 14 * DAY
      if (now - expiredAt > TRIAL_EXPIRY_NOTICE_WINDOW_DAYS * DAY) continue

      const email = await emailOf(t.id)
      await deliver(
        email,
        'Your TradingSocial Pro trial has ended',
        trialExpiredHtml({ name: t.display_name || t.username, kept: JOURNAL_FREE_LIMIT }),
      )
      await insertSystemNotification({ supabase: svc, userId: t.id, type: 'trial_expired' })
      // Written whether or not the email went out, so a missing provider can
      // never turn into the same user being mailed every day once one appears.
      const { error: stampError } = await svc.from('profiles')
        .update({ last_trial_email: new Date().toISOString() }).eq('id', t.id)
      if (stampError) {
        // Refuse to continue rather than re-notify this cohort tomorrow.
        logError('lifecycle-emails', stampError.message, { note: 'could not stamp last_trial_email, stopping' })
        break
      }
      trialNotices++
    }
  }

  // Analytics retention (audit item 17, F4 + F10). Bounds the lifetime of the
  // anonymous device identifier: deletes event rows for visitors who never
  // signed up after 12 months, and nulls anon_id on rows belonging to live
  // accounts so the count survives but the cross-visit device linkage does not.
  //
  // Rides on this route because Vercel Hobby caps the number of cron jobs and
  // there is no pg_cron on the project. Tolerant of 0055_analytics_retention.sql
  // not being applied yet, so the app can deploy ahead of the migration — but
  // the retention promise in privacy.html is not honoured until it is applied.
  let purged: { deleted: number; anonymised: number } | null = null
  try {
    const { data, error } = await svc.rpc('purge_analytics_events')
    if (error) {
      logWarn('lifecycle-emails', error.message, { note: 'analytics purge skipped' })
    } else {
      const row = Array.isArray(data) ? data[0] : data
      purged = { deleted: Number(row?.deleted ?? 0), anonymised: Number(row?.anonymised ?? 0) }
    }
  } catch (err) {
    logWarn('lifecycle-emails', err, { note: 'analytics purge failed' })
  }

  // The rest of the retention schedule (WS8). privacy.html section 13 now
  // states a period per class of record; these are the three that are ours to
  // enforce rather than a provider's, and until now only the analytics one
  // actually ran. `admin_audit_prune` has existed since 0052 and was never
  // scheduled — migration 0052 says so in its own comments and leaves the
  // choice of scheduler open. This is that choice: the same catch-all daily
  // route, for the same reason (Hobby caps cron jobs at 2, both taken, and
  // there is no pg_cron on the project).
  //
  // Every one is best-effort and tolerant of its migration not being applied,
  // so the app can deploy ahead of them. The corollary is the honest one: the
  // periods printed in the policy are not honoured until the migrations are.
  const retention: Record<string, number | 'skipped'> = {}
  for (const fn of ['admin_audit_prune', 'purge_trade_reports', 'purge_rate_limits'] as const) {
    try {
      const { data, error } = await svc.rpc(fn)
      if (error) {
        retention[fn] = 'skipped'
        logWarn('lifecycle-emails', error.message, { note: `${fn} skipped` })
      } else {
        retention[fn] = Number(Array.isArray(data) ? data[0] : data) || 0
      }
    } catch (err) {
      retention[fn] = 'skipped'
      logWarn('lifecycle-emails', err, { note: `${fn} failed` })
    }
  }

  // ---- Delivery summary ------------------------------------------------------
  // `digests`/`nudges`/`trialNotices` count users PROCESSED. `delivered` counts
  // mail that actually left. They are reported separately because conflating
  // them is precisely how a lifecycle system runs for months with no provider
  // configured while reporting success every night.
  const failureBreakdown = Object.fromEntries(failures)
  if (undelivered > 0) {
    // no_provider means RESEND_API_KEY is unset — the whole email programme is
    // off, not one message failing. Loud, and distinguished from per-message
    // errors, because the fix is one environment variable.
    if (failures.has('no_provider')) {
      logError('lifecycle-emails', 'RESEND_API_KEY is not configured — no lifecycle email is being delivered', {
        note: 'every message this run fell back to in-app notifications only',
        undelivered,
      })
    } else {
      logWarn('lifecycle-emails', `${undelivered} message(s) not delivered`, { failures: failureBreakdown })
    }
  }

  return NextResponse.json({
    // Not ok if we processed users but delivered nothing — that is the silent
    // failure this endpoint existed to hide.
    ok: undelivered === 0,
    emailConfigured: !failures.has('no_provider'),
    processed: { digests, nudges, trialNotices },
    delivery: { delivered, undelivered, failures: failureBreakdown },
    reconciled, purged, retention,
  })
}
