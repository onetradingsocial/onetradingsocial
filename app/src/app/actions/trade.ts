'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getTier } from '@/lib/server/entitlements'
import { getFeatureFlags } from '@/lib/server/feature-flags'
import { canFlag } from '@/lib/feature-flags'
import { pipInfo } from '@/lib/instruments'
import { trackServer } from '@/lib/server/track'
import { insertSystemNotification } from '@/lib/notifications'
import { analyzeCompliance, hasAnyRule } from '@/lib/rules'
import { markReferralActivated } from '@/lib/server/referral'
import { createServiceClient } from '@/lib/supabase/service'
import {
  computeOpen, computeClose, DIRECTIONS, SIZING_MODES, CONFIDENCE_LEVELS, EMOTIONS, MISTAKE_TAGS,
  type Direction, type SizingMode,
} from '@/lib/trade'

export type TradeState = { error?: string; ok?: boolean; tradeId?: string }

function num(v: FormDataEntryValue | null): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export async function createTrade(_prev: TradeState, formData: FormData): Promise<TradeState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const { data: profile } = await supabase
    .from('profiles').select('account_balance, is_public').eq('id', user.id).single()

  const market = String(formData.get('market') ?? '')
  const instrument = String(formData.get('instrument') ?? '').trim()
  const direction = String(formData.get('direction') ?? 'long') as Direction
  const sizingMode = String(formData.get('sizing_mode') ?? 'risk_percent') as SizingMode
  const entry = num(formData.get('entry_price'))
  const stop = num(formData.get('stop_price'))
  const target = num(formData.get('target_price'))
  const exit = num(formData.get('exit_price'))
  const riskPercent = num(formData.get('risk_percent'))
  const lots = num(formData.get('lots'))

  if (!instrument) return { error: 'Instrument is required.' }
  if (entry == null) return { error: 'Entry is required.' }
  // Quick entry (<60s) allows skipping the stop, but then risk-% sizing has
  // nothing to size against — lots become mandatory.
  if (stop == null && (sizingMode !== 'lots' || lots == null || lots <= 0)) {
    return { error: 'Without a stop loss, enter your position size in lots.' }
  }
  if (!(DIRECTIONS as readonly string[]).includes(direction)) return { error: 'Invalid direction.' }
  if (!(SIZING_MODES as readonly string[]).includes(sizingMode)) return { error: 'Invalid sizing mode.' }
  const confidence = String(formData.get('confidence') ?? '')
  const emotion = String(formData.get('emotion') ?? '')
  if (confidence && !(CONFIDENCE_LEVELS as readonly string[]).includes(confidence)) return { error: 'Invalid confidence.' }
  if (emotion && !(EMOTIONS as readonly string[]).includes(emotion)) return { error: 'Invalid emotion.' }

  const { pipSize, pipValuePerLot } = pipInfo(instrument, market)

  // Stop-less quick entry mirrors the MT5-import math: no risk figures, P/L
  // straight from pip movement × lot size. With a stop, the full model runs.
  let open: { slPips: number; tpPips: number | null; plannedRr: number | null; riskAmount: number }
  let closeFields: Record<string, unknown> = { status: 'open', outcome: 'open' }
  if (stop == null) {
    open = { slPips: 0, tpPips: null, plannedRr: null, riskAmount: 0 }
    if (exit != null) {
      const dirSign = direction === 'long' ? 1 : -1
      const realizedPips = Math.round(((exit - entry) * dirSign / pipSize) * 10) / 10
      const pnl = pipValuePerLot != null && Number.isFinite(pipValuePerLot)
        ? Math.round(realizedPips * pipValuePerLot * (lots ?? 0) * 100) / 100
        : null
      const byPips = realizedPips > 0 ? 'win' : realizedPips < 0 ? 'loss' : 'breakeven'
      closeFields = {
        status: 'closed', exit_price: exit, realized_pips: realizedPips,
        pnl_amount: pnl, r_multiple: null,
        outcome: pnl != null ? (pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven') : byPips,
        closed_at: new Date().toISOString(),
      }
    }
  } else {
    const computed = computeOpen({
      direction, entry, stop, target, pipSize, sizingMode,
      riskPercent, lots, accountBalance: profile?.account_balance ?? 0, pipValuePerLot,
    })
    if ('error' in computed) return { error: computed.error }
    open = computed
    if (exit != null) {
      const c = computeClose({ direction, entry, stop, exit, pipSize, riskAmount: open.riskAmount })
      closeFields = {
        status: 'closed', outcome: c.outcome, exit_price: exit,
        r_multiple: c.rMultiple, pnl_amount: c.pnlAmount, realized_pips: c.realizedPips,
        closed_at: new Date().toISOString(),
      }
    }
  }

  const tradedAt = String(formData.get('traded_at') ?? '') || new Date().toISOString()
  const isPublicRaw = formData.get('is_public')
  const isPublic = isPublicRaw == null ? (profile?.is_public ?? true) : isPublicRaw === 'public'

  // Advanced-journal fields (setup/confidence/emotion) are a Trader+ perk —
  // drop them server-side so the gate can't be bypassed with a hand-built form.
  const [tier, flags] = await Promise.all([getTier(supabase, user.id), getFeatureFlags()])
  const advanced = canFlag(flags, tier, 'advanced_journal')
  // Strategy tracking: Trader one tag, Pro multi-strategy.
  const maxStrategyTags = canFlag(flags, tier, 'strategy_tracking') ? (tier === 'pro' ? 8 : 1) : 0
  const strategyTags = formData.getAll('strategy_tags').map(String)
    .map((s) => s.trim()).filter(Boolean).slice(0, maxStrategyTags)
  const canPrivateNotes = canFlag(flags, tier, 'private_notes')

  const { data, error } = await supabase.from('trades').insert({
    user_id: user.id, market, instrument, direction, sizing_mode: sizingMode,
    entry_price: entry, stop_price: stop, target_price: target,
    risk_percent: riskPercent, lots, risk_amount: open.riskAmount,
    sl_pips: open.slPips, tp_pips: open.tpPips, planned_rr: open.plannedRr,
    setup_type: advanced ? String(formData.get('setup_type') ?? '') || null : null,
    confidence: advanced ? confidence || null : null,
    emotion: advanced ? emotion || null : null,
    note: canPrivateNotes ? String(formData.get('note') ?? '') || null : null,
    is_public: isPublic,
    mistake_tags: [],
    strategy_tags: strategyTags,
    traded_at: tradedAt,
    ...closeFields,
  }).select('id').single()

  if (error) return { error: error.message }

  // Funnel: first_trade_logged is the activation event.
  const { count } = await supabase
    .from('trades').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
  await trackServer(count === 1 ? 'first_trade_logged' : 'trade_logged', user, { market, source: 'manual' })

  // Referrals reward activation, not signups (row 39): the first logged trade
  // is what promotes a referral and notifies the referrer.
  if (count === 1) {
    try {
      const svc = createServiceClient()
      const referrerId = await markReferralActivated(svc, user.id)
      if (referrerId) {
        await insertSystemNotification({ supabase: svc, userId: referrerId, type: 'goal_completed' })
      }
    } catch { /* referral bookkeeping never blocks logging a trade */ }
  }

  revalidatePath('/journal')
  return { ok: true, tradeId: data.id }
}

export async function closeTrade(tradeId: string, exitPrice: number, mistakeTags: string[] = []): Promise<TradeState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  if (!Number.isFinite(exitPrice)) return { error: 'Invalid exit price.' }

  const { data: t } = await supabase
    .from('trades')
    .select('market, instrument, direction, entry_price, stop_price, risk_amount, planned_rr, risk_percent, traded_at, user_id')
    .eq('id', tradeId).single()
  if (!t || t.user_id !== user.id) return { error: 'Trade not found.' }

  // Mistake tagging is a Trader+ perk; only known presets are stored.
  let mistakes: string[] = []
  if (mistakeTags.length > 0) {
    const canTag = canFlag(await getFeatureFlags(), await getTier(supabase, user.id), 'mistake_tagging')
    if (canTag) mistakes = mistakeTags.filter((m) => (MISTAKE_TAGS as readonly string[]).includes(m))
  }

  const { pipSize } = pipInfo(t.instrument, t.market)
  const c = computeClose({
    direction: t.direction as Direction, entry: t.entry_price, stop: t.stop_price,
    exit: exitPrice, pipSize, riskAmount: t.risk_amount,
  })
  const { error } = await supabase.from('trades').update({
    status: 'closed', outcome: c.outcome, exit_price: exitPrice,
    r_multiple: c.rMultiple, pnl_amount: c.pnlAmount, realized_pips: c.realizedPips,
    mistake_tags: mistakes,
    closed_at: new Date().toISOString(),
  }).eq('id', tradeId)
  if (error) return { error: error.message }

  // Rule breach notification (row 31): evaluate this trade against the user's
  // rules; if it broke one, let them know. Best-effort, never fails the close.
  try {
    const { data: r } = await supabase.from('trading_rules').select('*').eq('user_id', user.id).maybeSingle()
    if (r) {
      const rules = {
        maxTradesPerDay: r.max_trades_per_day, minRr: r.min_rr, maxRiskPercent: r.max_risk_percent,
        requireStop: r.require_stop, session: r.session, noTradeAfterLosses: r.no_trade_after_losses,
      }
      if (hasAnyRule(rules)) {
        const res = analyzeCompliance(rules, [{
          tradedAt: t.traded_at, plannedRr: t.planned_rr, riskPercent: t.risk_percent,
          hasStop: t.stop_price != null, rMultiple: c.rMultiple, pnlAmount: c.pnlAmount,
        }])
        if (res.broken > 0) {
          await insertSystemNotification({ supabase, userId: user.id, type: 'rule_breach' })
        }
      }
    }
  } catch { /* notifications never block the close */ }

  revalidatePath('/journal')
  return { ok: true }
}

export async function saveTradeChartUrl(tradeId: string, publicUrl: string): Promise<TradeState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const prefix = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/`
  if (!publicUrl.startsWith(prefix)) return { error: 'Invalid chart URL.' }
  const { error } = await supabase.from('trades')
    .update({ screenshot_url: publicUrl }).eq('id', tradeId).eq('user_id', user.id)
  if (error) return { error: error.message }
  return { ok: true }
}

export async function deleteTrade(tradeId: string): Promise<TradeState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const { error } = await supabase.from('trades').delete().eq('id', tradeId).eq('user_id', user.id)
  if (error) return { error: error.message }
  revalidatePath('/journal')
  return { ok: true }
}
