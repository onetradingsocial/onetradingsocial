import { NextResponse } from 'next/server'
import { authorizedCron } from '@/lib/cron'
import { createServiceClient } from '@/lib/supabase/service'
import { sendEmail, weeklyDigestHtml, recoveryHtml, trialExpiredHtml } from '@/lib/server/email'
import { insertSystemNotification } from '@/lib/notifications'
import { computeMetrics, type TradeForMetrics } from '@/lib/trade'
import { generateInsights } from '@/lib/insights'
import { trialState, JOURNAL_FREE_LIMIT } from '@/lib/entitlements'
import { getStripe } from '@/lib/stripe'
import { reconcileBilling } from '@/lib/server/billing-reconcile'

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
    console.error('[lifecycle-emails] billing reconcile failed', err)
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

  for (const u of users) {
    const name = u.display_name || u.username
    const prefs = (u.notification_prefs ?? {}) as Record<string, boolean>

    const { data: trades } = await svc
      .from('trades').select('r_multiple, pnl_amount, outcome, status, traded_at, setup_type, strategy_tags, mistake_tags')
      .eq('user_id', u.id).order('traded_at', { ascending: false }).limit(500)
    const rows = trades ?? []
    const lastTradeMs = rows[0] ? Date.parse(rows[0].traded_at) : null

    // ---- Weekly digest: at most every 7 days, needs ≥1 trade this week ----
    const weekAgo = now - 7 * DAY
    const dueWeekly = !u.last_weekly_email || Date.parse(u.last_weekly_email) < weekAgo
    const weekTrades = rows.filter((t) => t.status === 'closed' && Date.parse(t.traded_at) >= weekAgo && t.r_multiple != null)
    if (dueWeekly && weekTrades.length > 0 && prefs.weekly_report !== false) {
      const m = computeMetrics(weekTrades.map((t): TradeForMetrics => ({
        status: 'closed', outcome: t.outcome as TradeForMetrics['outcome'], rMultiple: t.r_multiple,
        pnlAmount: t.pnl_amount, tradedAt: t.traded_at, mistakeTags: t.mistake_tags ?? [],
      })))
      const insights = generateInsights(rows.filter((t) => t.status === 'closed').map((t) => ({
        rMultiple: t.r_multiple, pnlAmount: t.pnl_amount, tradedAt: t.traded_at,
        setupType: t.setup_type, strategyTags: t.strategy_tags ?? [], mistakeTags: t.mistake_tags ?? [],
      })))
      const netR = weekTrades.reduce((s, t) => s + (t.r_multiple ?? 0), 0)
      const mc = new Map<string, number>()
      for (const t of weekTrades) for (const mm of t.mistake_tags ?? []) mc.set(mm, (mc.get(mm) ?? 0) + 1)
      const worstMistake = [...mc.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]

      const html = weeklyDigestHtml({
        name, trades: m.total, winRate: m.winRate, netR,
        improvement: m.winRate >= 0.5 ? 'Your win rate held above 50% this week.' : 'You stayed active and logged your trades — consistency compounds.',
        mistake: worstMistake ? `You tagged "${worstMistake}" most often — worth a closer look.` : 'No recurring mistakes tagged this week.',
        insight: insights[0]?.text ?? 'Log a few more trades to unlock deeper insights.',
        action: netR < 0 ? 'Review your losing trades before your next session.' : 'Keep doing what worked — and size consistently.',
      })
      const email = await emailOf(u.id)
      if (email) await sendEmail({ to: email, subject: 'Your weekly trading review', html })
      await insertSystemNotification({ supabase: svc, userId: u.id, type: 'weekly_report' })
      await svc.from('profiles').update({ last_weekly_email: new Date().toISOString() }).eq('id', u.id)
      digests++
      continue // don't also nudge the same user this run
    }

    // ---- Inactivity recovery: throttle to once per 7 days ----
    const recentlyNudged = u.last_recovery_email && Date.parse(u.last_recovery_email) > now - 7 * DAY
    if (recentlyNudged) continue

    const ageDays = (now - Date.parse(u.created_at)) / DAY
    let reason: string | null = null
    let cta = 'Log your first trade', href = '/journal'

    if (rows.length === 0 && ageDays >= 2 && ageDays <= 30) {
      reason = 'You signed up but haven\'t logged a trade yet. It takes under a minute — and your stats start building immediately.'
    } else if (rows.length === 1 && lastTradeMs && now - lastTradeMs >= 7 * DAY) {
      reason = 'You logged one trade and then went quiet. One trade isn\'t a track record — log a few more to see real patterns.'
      cta = 'Log another trade'
    } else if (lastTradeMs && now - lastTradeMs >= 7 * DAY && now - lastTradeMs <= 30 * DAY) {
      reason = 'It\'s been over a week since your last logged trade. Your journal is waiting.'
      cta = 'Back to your journal'
    }

    if (reason) {
      const email = await emailOf(u.id)
      if (email) await sendEmail({ to: email, subject: 'Your TradingSocial journal is waiting', html: recoveryHtml(name, reason, cta, href) })
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
    console.error('[lifecycle-emails] trial notice skipped (migration not applied?)', trialError.message)
  } else {
    for (const t of trials ?? []) {
      if (trialState(t.trial_started_at, t.trial_ack_at, nowDate) !== 'expired') continue
      // Only recently lapsed trials — see TRIAL_EXPIRY_NOTICE_WINDOW_DAYS.
      const expiredAt = Date.parse(t.trial_started_at) + 14 * DAY
      if (now - expiredAt > TRIAL_EXPIRY_NOTICE_WINDOW_DAYS * DAY) continue

      const email = await emailOf(t.id)
      if (email) {
        await sendEmail({
          to: email,
          subject: 'Your TradingSocial Pro trial has ended',
          html: trialExpiredHtml({
            name: t.display_name || t.username, kept: JOURNAL_FREE_LIMIT,
          }),
        })
      }
      await insertSystemNotification({ supabase: svc, userId: t.id, type: 'trial_expired' })
      // Written whether or not the email went out, so a missing provider can
      // never turn into the same user being mailed every day once one appears.
      const { error: stampError } = await svc.from('profiles')
        .update({ last_trial_email: new Date().toISOString() }).eq('id', t.id)
      if (stampError) {
        // Refuse to continue rather than re-notify this cohort tomorrow.
        console.error('[lifecycle-emails] could not stamp last_trial_email, stopping', stampError.message)
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
      console.warn('[lifecycle-emails] analytics purge skipped:', error.message)
    } else {
      const row = Array.isArray(data) ? data[0] : data
      purged = { deleted: Number(row?.deleted ?? 0), anonymised: Number(row?.anonymised ?? 0) }
    }
  } catch (err) {
    console.warn('[lifecycle-emails] analytics purge failed', err)
  }

  return NextResponse.json({ ok: true, digests, nudges, trialNotices, reconciled, purged })
}
