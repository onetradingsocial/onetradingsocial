import { NextResponse } from 'next/server'
import { authorizedCron } from '@/lib/cron'
import { createServiceClient } from '@/lib/supabase/service'
import { sendEmail, weeklyDigestHtml, recoveryHtml } from '@/lib/server/email'
import { insertSystemNotification } from '@/lib/notifications'
import { computeMetrics, type TradeForMetrics } from '@/lib/trade'
import { generateInsights } from '@/lib/insights'

export const maxDuration = 60

const DAY = 864e5

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

  return NextResponse.json({ ok: true, digests, nudges })
}
