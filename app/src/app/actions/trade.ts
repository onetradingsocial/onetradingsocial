'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getTier } from '@/lib/server/entitlements'
import { getFeatureFlags } from '@/lib/server/feature-flags'
import { canFlag, type FlagMap } from '@/lib/feature-flags'
import type { Tier } from '@/lib/entitlements'
import { pipInfo } from '@/lib/instruments'
import { trackServer } from '@/lib/server/track'
import { insertSystemNotification } from '@/lib/notifications'
import { analyzeCompliance, hasAnyRule } from '@/lib/rules'
import { markReferralActivated } from '@/lib/server/referral'
import { createServiceClient } from '@/lib/supabase/service'
import { tradeChartPrefix } from '@/lib/storage'
import {
  computeOpen, computeClose, DIRECTIONS, SIZING_MODES, CONFIDENCE_LEVELS, EMOTIONS, MISTAKE_TAGS,
  type Direction, type SizingMode, type Outcome,
} from '@/lib/trade'
import { allowAction, JOURNAL_BUDGET, UPLOAD_BUDGET } from '@/lib/server/action-throttle'

export type TradeState = { error?: string; ok?: boolean; tradeId?: string }

function num(v: FormDataEntryValue | null): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// ---------------------------------------------------------------------------
// Shared trade-form parsing and derived-field maths
//
// `createTrade` and `updateTrade` must agree to the last decimal: an edit that
// recomputed P/L even slightly differently from the original log would make a
// no-op edit move the number, and every leaderboard metric is a sum over these
// columns. So the parse, the guards and the maths live here once and both
// actions call them, rather than the edit path carrying a second copy that can
// drift.
// ---------------------------------------------------------------------------

type TradeFormInput = {
  market: string
  instrument: string
  direction: Direction
  sizingMode: SizingMode
  entry: number
  stop: number | null
  target: number | null
  exit: number | null
  riskPercent: number | null
  lots: number | null
  confidence: string
  emotion: string
  tradedAt: string
}

/** Every column the maths owns. Always the FULL set, including the nulls: an
 *  edit that reopens a closed trade has to clear `pnl_amount`, `r_multiple`,
 *  `realized_pips` and `closed_at`, and it can only do that by writing them. */
type DerivedTradeFields = {
  sl_pips: number
  tp_pips: number | null
  planned_rr: number | null
  risk_amount: number
  status: 'open' | 'closed'
  outcome: Outcome
  exit_price: number | null
  r_multiple: number | null
  pnl_amount: number | null
  realized_pips: number | null
  closed_at: string | null
}

/** Advanced-journal fields are a Trader+ perk — the same gate on both paths. */
function journalCaps(flags: FlagMap, tier: Tier) {
  return {
    advanced: canFlag(flags, tier, 'advanced_journal'),
    // Strategy tracking: Trader one tag, Pro multi-strategy.
    maxStrategyTags: canFlag(flags, tier, 'strategy_tracking') ? (tier === 'pro' ? 8 : 1) : 0,
    canPrivateNotes: canFlag(flags, tier, 'private_notes'),
  }
}
type JournalCaps = ReturnType<typeof journalCaps>

function enumError(confidence: string, emotion: string): string | null {
  if (confidence && !(CONFIDENCE_LEVELS as readonly string[]).includes(confidence)) return 'Invalid confidence.'
  if (emotion && !(EMOTIONS as readonly string[]).includes(emotion)) return 'Invalid emotion.'
  return null
}

/**
 * The journal subset — the fields 0028's trigger leaves editable on an
 * imported trade.
 *
 * `omitUngated` is the difference between logging and editing. On INSERT an
 * unentitled field is written as null, which is correct: the user never had
 * it. On UPDATE, writing null would DELETE the setup/emotion/note a user
 * recorded while on Trader from every trade they later edit on Free — a
 * lapsed subscription would quietly eat their journal. So an edit omits what
 * the caller is not entitled to instead of nulling it: the gate still blocks
 * a hand-built form from SETTING the field, and existing data survives.
 */
function journalFields(
  formData: FormData, caps: JournalCaps,
  opts: { omitUngated?: boolean; existingTags?: string[] } = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (caps.advanced) {
    out.setup_type = String(formData.get('setup_type') ?? '') || null
    out.confidence = String(formData.get('confidence') ?? '') || null
    out.emotion = String(formData.get('emotion') ?? '') || null
  } else if (!opts.omitUngated) {
    out.setup_type = null
    out.confidence = null
    out.emotion = null
  }
  if (caps.canPrivateNotes) out.note = String(formData.get('note') ?? '') || null
  else if (!opts.omitUngated) out.note = null
  if (caps.maxStrategyTags > 0 || !opts.omitUngated) {
    const submitted = formData.getAll('strategy_tags').map(String)
      .map((s) => s.trim()).filter(Boolean)
    out.strategy_tags = opts.existingTags
      ? keepThenCap(submitted, opts.existingTags, caps.maxStrategyTags)
      : submitted.slice(0, caps.maxStrategyTags)
  }
  return out
}

/**
 * The tag cap limits ADDING, never destroys what is already stored.
 *
 * `slice(0, cap)` is right on insert and wrong on edit. Pro allows 8 strategy
 * tags and Trader allows 1 (`journalCaps`), so a lapsed Pro user opening a
 * three-tag trade on Trader would have had two of them silently dropped by the
 * slice — no warning, nothing to undo, and the edit they actually came to make
 * carries the deletion with it. Same failure `omitUngated` fixes for the
 * ungated fields, one tier up: there the cap is 0 and the field is omitted
 * whole, here the cap is merely smaller than the data.
 *
 * So a submitted tag that is already on the trade is always kept, and new tags
 * fill whatever headroom the cap has left. A user over their cap can still
 * remove tags and cannot add any until they are back under it.
 */
function keepThenCap(submitted: string[], existing: string[], cap: number): string[] {
  const stored = new Set(existing)
  const kept = submitted.filter((t) => stored.has(t))
  const added = submitted.filter((t) => !stored.has(t))
  return [...kept, ...added.slice(0, Math.max(0, cap - kept.length))]
}

/**
 * Parse + validate the execution half of the form. Guard order is the order
 * `createTrade` has always used, so the message a bad form gets is unchanged.
 *
 * `tradedAtFallback` is what an ABSENT or blank `traded_at` field falls back
 * to: `now` when logging a new trade, the stored date when editing one. It is
 * a default, not an override — a submitted date is always honoured, and always
 * validated.
 */
function parseTradeForm(
  formData: FormData, now: string, tradedAtFallback?: string,
): TradeFormInput | { error: string } {
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
  // num() only rejects non-finite, so a zero or negative price would reach the
  // pip maths and produce nonsense P/L. No instrument here trades at or below 0.
  if (entry <= 0) return { error: 'Entry price must be greater than zero.' }
  if (exit != null && exit <= 0) return { error: 'Exit price must be greater than zero.' }
  // Quick entry (<60s) allows skipping the stop, but then risk-% sizing has
  // nothing to size against — lots become mandatory.
  if (stop == null && (sizingMode !== 'lots' || lots == null || lots <= 0)) {
    return { error: 'Without a stop loss, enter your position size in lots.' }
  }
  if (!(DIRECTIONS as readonly string[]).includes(direction)) return { error: 'Invalid direction.' }
  if (!(SIZING_MODES as readonly string[]).includes(sizingMode)) return { error: 'Invalid sizing mode.' }
  const confidence = String(formData.get('confidence') ?? '')
  const emotion = String(formData.get('emotion') ?? '')
  const bad = enumError(confidence, emotion)
  if (bad) return { error: bad }

  // A future trade date is either a mistake or leaderboard gaming — one
  // fabricated 2031 entry was enough to top the public board. The input carries
  // a `max`, but that is only a hint: the check has to live here. A minute of
  // slack absorbs clock skew between the browser and the server.
  const tradedAtRaw = String(formData.get('traded_at') ?? '')
  const tradedAt = tradedAtRaw || tradedAtFallback || now
  const tradedAtMs = Date.parse(tradedAt)
  if (!Number.isFinite(tradedAtMs)) return { error: 'Invalid trade date.' }
  if (tradedAtMs > Date.now() + 60_000) return { error: 'Trade date cannot be in the future.' }

  return {
    market, instrument, direction, sizingMode, entry, stop, target, exit,
    riskPercent, lots, confidence, emotion, tradedAt,
  }
}

/**
 * Pick a `closed_at` that satisfies migration 0045's `closed_at >= traded_at`.
 *
 * `existing` is kept whenever the trade stays closed. Re-stamping it to `now`
 * on every edit would drag a trade closed in March into today's bucket, and
 * every time-window metric — the rolling leaderboard, XP days/weeks, the
 * equity curve — reads that column. A correction to the exit PRICE is not a
 * claim that the trade closed today.
 *
 * The floor handles the two ways the pair can end up inverted, and it is a
 * FLOOR rather than a re-stamp so that it moves `closed_at` only as far as it
 * has to:
 *
 *   - on the insert path, a trade dated inside the 60s of allowed clock skew
 *     used to be stamped with a `now` fractionally BEFORE its own `traded_at`,
 *     which is the exact inversion 0045's one-second grace exists to forgive;
 *
 *   - on the edit path, `traded_at` is now movable (0067), so a user can drag
 *     the trade date FORWARD past the `closed_at` of an already-closed trade.
 *     Sending that pair violates `trades_closed_after_traded` and the user gets
 *     a raw 23514 for something the form let them do. Collapsing `closed_at`
 *     onto the new `traded_at` keeps the row coherent — the trade did not close
 *     before it was opened — and is the least the constraint will accept.
 */
function closedAtStamp(existing: string | null, tradedAt: string, now: string): string {
  const base = existing ?? now
  return Date.parse(base) >= Date.parse(tradedAt) ? base : tradedAt
}

function deriveTradeFields(
  input: TradeFormInput,
  ctx: { accountBalance: number; now: string; existingClosedAt: string | null },
): DerivedTradeFields | { error: string } {
  const { pipSize, pipValuePerLot } = pipInfo(input.instrument, input.market)
  const stillOpen = {
    status: 'open', outcome: 'open', exit_price: null,
    r_multiple: null, pnl_amount: null, realized_pips: null, closed_at: null,
  } as const

  // Stop-less quick entry mirrors the MT5-import math: no risk figures, P/L
  // straight from pip movement × lot size. With a stop, the full model runs.
  if (input.stop == null) {
    const plan = { sl_pips: 0, tp_pips: null, planned_rr: null, risk_amount: 0 }
    if (input.exit == null) return { ...plan, ...stillOpen }
    const dirSign = input.direction === 'long' ? 1 : -1
    const realizedPips = Math.round(((input.exit - input.entry) * dirSign / pipSize) * 10) / 10
    const pnl = pipValuePerLot != null && Number.isFinite(pipValuePerLot)
      ? Math.round(realizedPips * pipValuePerLot * (input.lots ?? 0) * 100) / 100
      : null
    const byPips = realizedPips > 0 ? 'win' : realizedPips < 0 ? 'loss' : 'breakeven'
    return {
      ...plan,
      status: 'closed', exit_price: input.exit, realized_pips: realizedPips,
      pnl_amount: pnl, r_multiple: null,
      outcome: pnl != null ? (pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven') : byPips,
      closed_at: closedAtStamp(ctx.existingClosedAt, input.tradedAt, ctx.now),
    }
  }

  const computed = computeOpen({
    direction: input.direction, entry: input.entry, stop: input.stop, target: input.target,
    pipSize, sizingMode: input.sizingMode, riskPercent: input.riskPercent, lots: input.lots,
    accountBalance: ctx.accountBalance, pipValuePerLot,
  })
  if ('error' in computed) return { error: computed.error }
  const plan = {
    sl_pips: computed.slPips, tp_pips: computed.tpPips,
    planned_rr: computed.plannedRr, risk_amount: computed.riskAmount,
  }
  if (input.exit == null) return { ...plan, ...stillOpen }
  const c = computeClose({
    direction: input.direction, entry: input.entry, stop: input.stop,
    exit: input.exit, pipSize, riskAmount: computed.riskAmount,
  })
  return {
    ...plan,
    status: 'closed', outcome: c.outcome, exit_price: input.exit,
    r_multiple: c.rMultiple, pnl_amount: c.pnlAmount, realized_pips: c.realizedPips,
    closed_at: closedAtStamp(ctx.existingClosedAt, input.tradedAt, ctx.now),
  }
}

export async function createTrade(_prev: TradeState, formData: FormData): Promise<TradeState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const gate = await allowAction(JOURNAL_BUDGET, user.id)
  if (!gate.ok) return { error: gate.message }

  // Service client: 0047 revokes SELECT on account_balance from both client
  // roles, and risk%-sized trades size themselves off it. Scoped to user.id
  // from getUser(), so it reads only the caller's own row.
  const { data: profile } = await createServiceClient()
    .from('profiles').select('account_balance, is_public').eq('id', user.id).single()

  // One clock read for the whole request. `closed_at` used to be stamped with
  // its own `new Date()` a few lines above the `traded_at` fallback, so a
  // quick entry that opened and closed in the same submission could land
  // closed_at 1 ms BEFORE traded_at — an impossible trade. Three such rows
  // exist in production and they are why the closed_at >= traded_at check in
  // migration 0045 carries a one-second grace.
  const now = new Date().toISOString()

  const parsed = parseTradeForm(formData, now)
  if ('error' in parsed) return { error: parsed.error }

  const derived = deriveTradeFields(parsed, {
    accountBalance: profile?.account_balance ?? 0, now, existingClosedAt: null,
  })
  if ('error' in derived) return { error: derived.error }

  const isPublicRaw = formData.get('is_public')
  const isPublic = isPublicRaw == null ? (profile?.is_public ?? true) : isPublicRaw === 'public'

  // Advanced-journal fields (setup/confidence/emotion) are a Trader+ perk —
  // drop them server-side so the gate can't be bypassed with a hand-built form.
  const [tier, flags] = await Promise.all([getTier(supabase, user.id), getFeatureFlags()])

  const { data, error } = await supabase.from('trades').insert({
    user_id: user.id,
    market: parsed.market, instrument: parsed.instrument, direction: parsed.direction,
    sizing_mode: parsed.sizingMode,
    entry_price: parsed.entry, stop_price: parsed.stop, target_price: parsed.target,
    risk_percent: parsed.riskPercent, lots: parsed.lots,
    is_public: isPublic,
    mistake_tags: [],
    traded_at: parsed.tradedAt,
    ...journalFields(formData, journalCaps(flags, tier)),
    ...derived,
  }).select('id').single()

  if (error) return { error: error.message }

  // Funnel: first_trade_logged is the activation event.
  const { count } = await supabase
    .from('trades').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
  await trackServer(count === 1 ? 'first_trade_logged' : 'trade_logged', user, { market: parsed.market, source: 'manual' })

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

/**
 * The execution columns a non-`manual` trade locks, paired with the form field
 * that carries each one.
 *
 * This list does not do the locking — 0028's trigger does, and the imported
 * path never puts an execution column in the payload regardless. What it
 * decides is which attempted changes we can report HONESTLY instead of
 * dropping in silence. `traded_at` earns its place here now that the date is
 * editable on manual trades: without it, a user moving an imported trade's
 * date would get a success toast and an unchanged date.
 */
const LOCKED_EXECUTION_FIELDS = [
  { field: 'market', column: 'market', kind: 'text' },
  { field: 'instrument', column: 'instrument', kind: 'text' },
  { field: 'direction', column: 'direction', kind: 'text' },
  { field: 'sizing_mode', column: 'sizing_mode', kind: 'text' },
  { field: 'entry_price', column: 'entry_price', kind: 'number' },
  { field: 'stop_price', column: 'stop_price', kind: 'number' },
  { field: 'target_price', column: 'target_price', kind: 'number' },
  { field: 'exit_price', column: 'exit_price', kind: 'number' },
  { field: 'risk_percent', column: 'risk_percent', kind: 'number' },
  { field: 'lots', column: 'lots', kind: 'number' },
  { field: 'traded_at', column: 'traded_at', kind: 'instant' },
] as const

/** True only when both sides name a real, unambiguous instant and they differ.
 *
 *  A `datetime-local` input posts a zone-LESS string ("2026-08-01T09:00"),
 *  which `Date.parse` reads as browser-local while the column is a
 *  `timestamptz` — comparing those would refuse edits that changed nothing and
 *  lock a user out of editing an imported trade's NOTES. So a value with no
 *  zone designator is treated as "cannot compare" and skipped, leaving the
 *  trigger as the only opinion. The edit form posts the stored ISO string for
 *  imported trades, so the comparison does run where it matters. */
function instantChanged(submitted: string, stored: unknown): boolean {
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(submitted.trim())) return false
  const a = Date.parse(submitted)
  const b = Date.parse(String(stored ?? ''))
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  return a !== b
}

const IMPORTED_EXECUTION_LOCKED =
  'Imported trades keep their execution data as the broker reported it, so entry, stop, exit, size, instrument and the trade date cannot be edited. Your notes, tags, emotion, confidence and visibility all saved. If the execution data itself is wrong, use the Help button and we will look at it.'

function lockedFieldChanged(formData: FormData, row: Record<string, unknown>): boolean {
  for (const f of LOCKED_EXECUTION_FIELDS) {
    // Only what the form actually submitted. A UI that renders the execution
    // inputs disabled sends nothing for them, and "absent" is not "cleared".
    if (!formData.has(f.field)) continue
    const raw = formData.get(f.field)
    if (f.kind === 'number') {
      const submitted = num(raw)
      const stored = row[f.column] == null ? null : Number(row[f.column])
      if (submitted !== stored) return true
    } else if (f.kind === 'instant') {
      if (instantChanged(String(raw ?? ''), row[f.column])) return true
    } else if (String(raw ?? '').trim() !== String(row[f.column] ?? '')) {
      return true
    }
  }
  return false
}

/**
 * Edit a trade the caller already logged.
 *
 * ── THE SOURCE GATE ──────────────────────────────────────────────────────────
 *
 * `deleteTrade`'s comment explains why a broker-synced or statement-imported
 * row is not the user's to rewrite; editing is the same argument with a
 * sharper edge, because an edit does not need to remove a losing trade to
 * flatter a leaderboard — it can just move the exit price.
 *
 * The control is the 0028 trigger `protect_imported_trade_fields`, which
 * raises when any execution column on a non-`manual` row changes and lets the
 * journal columns (note, screenshot, tags, emotion, confidence, visibility)
 * through. The trigger raises a RAW POSTGRES EXCEPTION, which would reach the
 * user as "Imported execution data is locked; only journal fields can be
 * edited." — a database error, in a toast, for something they were allowed to
 * try. So this action never sends an execution column for an imported trade at
 * all: the journal payload is built on its own path, and a form that did try to
 * change execution data is refused here, in words, before any write.
 *
 * ── WHAT IS RECOMPUTED ───────────────────────────────────────────────────────
 *
 * A manual edit re-derives every dependent column through the same
 * `deriveTradeFields` the insert path uses. That includes the reopen case:
 * clearing the exit price returns the trade to `open` AND nulls exit_price,
 * pnl_amount, r_multiple, realized_pips and closed_at. Leaving those in place
 * would strand a realised P/L on a trade with no exit, and since
 * `lib/leaderboard.ts` and `lib/trade.ts#computeMetrics` sum by `outcome` and
 * `pnl_amount` rather than by exit price, that phantom result would be counted
 * everywhere.
 *
 * `traded_at` is editable on a manual trade, and that is a decision with a
 * cost — see migration 0067. What holds the line here is the future-date
 * rejection inherited from `parseTradeForm`: a date may be moved within the
 * past, never into the future.
 *
 * ── ENTITLEMENTS ─────────────────────────────────────────────────────────────
 *
 * `journalFields(..., { omitUngated: true })`. On INSERT an unentitled field is
 * written as null; on UPDATE that would mean a Pro user who drops to Free wipes
 * the setup, emotion, confidence, note and strategy tags off every old trade
 * they open the edit modal on — the form correctly hides those inputs, so
 * nothing is submitted, and a mirrored gate would null them. The gate here
 * omits instead, so it still blocks a hand-built form from SETTING a field the
 * caller has not paid for, without deleting what they recorded when they had.
 *
 * ── WHAT IS NOT DONE ─────────────────────────────────────────────────────────
 *
 * No `trade_logged` analytics, no referral activation, no rule-breach
 * notification. An edit is a correction to a trade that already fired all
 * three. The rule-breach case is the arguable one — an edit can close an open
 * trade, which is what `closeTrade` notifies on — but compliance is recomputed
 * from the rows on every read (`journal/page.tsx`, `lib/server/goals.ts`), so
 * the analysis is never stale; the only thing skipping it costs is a push, and
 * the only thing firing it would add is a duplicate breach alert every time the
 * user re-saves the same trade.
 */
/**
 * Hiding a settled result is the cheapest way to launder a bad week.
 *
 * `ranking.ts:111` builds every board from `is_public = true` rows, and 0067
 * granted UPDATE on `is_public` for the first time (0045 had withheld it, so
 * before the edit feature nothing could change it after insert). Left open,
 * that turns the leaderboard into a per-trade opt-out a user can exercise
 * AFTER seeing the outcome — and because visibility is a journal field rather
 * than an execution one, 0028's trigger does not stop it happening on a
 * broker-verified trade either.
 *
 * So the toggle runs one way once the result is known: a trade can always be
 * published, and an OPEN trade can still be hidden, but a CLOSED public trade
 * cannot be taken private. Nothing an honest user does needs that direction —
 * they publish a trade they held back, they do not un-publish a loss.
 */
const VISIBILITY_ONE_WAY =
  'A closed trade that is public cannot be made private — hiding a settled result would let a bad week be taken off the leaderboard after the fact. You can still make an open trade private, and you can always publish a private one.'

export async function updateTrade(tradeId: string, formData: FormData): Promise<TradeState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const gate = await allowAction(JOURNAL_BUDGET, user.id)
  if (!gate.ok) return { error: gate.message }

  // Scoped to the caller's own row, so a foreign id is indistinguishable from a
  // missing one — the same answer `deleteTrade` gives, and for the same reason.
  const { data: existing, error: readError } = await supabase
    .from('trades')
    .select('source, market, instrument, direction, sizing_mode, entry_price, stop_price, target_price, exit_price, risk_percent, lots, traded_at, closed_at, strategy_tags, status, is_public')
    .eq('id', tradeId).eq('user_id', user.id).maybeSingle()
  if (readError) return { error: readError.message }
  if (!existing) return { error: 'Trade not found.' }

  const [tier, flags] = await Promise.all([getTier(supabase, user.id), getFeatureFlags()])
  const caps = journalCaps(flags, tier)

  const payload: Record<string, unknown> = journalFields(formData, caps, {
    omitUngated: true, existingTags: existing.strategy_tags ?? [],
  })
  const isPublicRaw = formData.get('is_public')

  if (existing.source !== 'manual') {
    // The journal enums still have to be checked: this path never reaches
    // parseTradeForm, so nothing else would stop a hand-built form writing
    // `confidence=nuclear` and getting a 22P02 back from the enum cast.
    const bad = enumError(
      String(formData.get('confidence') ?? ''), String(formData.get('emotion') ?? ''),
    )
    if (bad) return { error: bad }
    if (lockedFieldChanged(formData, existing)) return { error: IMPORTED_EXECUTION_LOCKED }
  } else {
    const now = new Date().toISOString()
    // The stored date is the FALLBACK, not a pin: a form that omits `traded_at`
    // keeps the date the trade already has rather than resetting it to now. A
    // submitted date is honoured and goes through `createTrade`'s own guards —
    // in particular the future-date rejection, which is the control that
    // matters here. See migration 0067.
    const parsed = parseTradeForm(formData, now, String(existing.traded_at))
    if ('error' in parsed) return { error: parsed.error }

    // Service client: 0047 revokes SELECT on account_balance from both client
    // roles, and risk%-sized trades size themselves off it. Scoped to user.id
    // from getUser(), so it reads only the caller's own row.
    const { data: profile } = await createServiceClient()
      .from('profiles').select('account_balance').eq('id', user.id).single()

    const derived = deriveTradeFields(parsed, {
      accountBalance: profile?.account_balance ?? 0, now,
      existingClosedAt: existing.closed_at ?? null,
    })
    if ('error' in derived) return { error: derived.error }

    Object.assign(payload, {
      market: parsed.market, instrument: parsed.instrument, direction: parsed.direction,
      sizing_mode: parsed.sizingMode,
      entry_price: parsed.entry, stop_price: parsed.stop, target_price: parsed.target,
      risk_percent: parsed.riskPercent, lots: parsed.lots,
      traded_at: parsed.tradedAt,
    }, derived)
  }

  // Visibility is one-way once a result is settled. See VISIBILITY_ONE_WAY.
  // Applied after the branch because it must test the status this edit RESULTS
  // in, not the stored one: adding an exit price and switching to private in
  // the same submission would otherwise walk straight through the check.
  if (isPublicRaw != null) {
    const wantsPublic = isPublicRaw === 'public'
    const willBeClosed = (payload.status ?? existing.status) === 'closed'
    if (!wantsPublic && existing.is_public === true && willBeClosed) {
      return { error: VISIBILITY_ONE_WAY }
    }
    payload.is_public = wantsPublic
  }

  const { error } = await supabase.from('trades').update(payload)
    .eq('id', tradeId).eq('user_id', user.id)
  if (error) return { error: error.message }

  revalidatePath('/journal')
  return { ok: true }
}

export async function closeTrade(tradeId: string, exitPrice: number, mistakeTags: string[] = []): Promise<TradeState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const gate = await allowAction(JOURNAL_BUDGET, user.id)
  if (!gate.ok) return { error: gate.message }
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
          // Service client: insertSystemNotification reads notification_prefs,
          // which 0047 revokes from both client roles. (It also inserts into
          // `notifications`, a table with no INSERT policy for clients, so the
          // user client was never the right one here.)
          await insertSystemNotification({ supabase: createServiceClient(), userId: user.id, type: 'rule_breach' })
        }
      }
    }
  } catch { /* notifications never block the close */ }

  revalidatePath('/journal')
  return { ok: true }
}

export async function saveTradeChartUrl(tradeId: string, chartUrl: string): Promise<TradeState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const gate = await allowAction(UPLOAD_BUDGET, user.id)
  if (!gate.ok) return { error: gate.message }
  // Charts now live in the private bucket and are read through
  // /api/private-image. The prefix is scoped to the caller's own uid, so a
  // crafted URL cannot point a trade at somebody else's object.
  if (!chartUrl.startsWith(tradeChartPrefix(user.id))) return { error: 'Invalid chart URL.' }
  const { error } = await supabase.from('trades')
    .update({ screenshot_url: chartUrl }).eq('id', tradeId).eq('user_id', user.id)
  if (error) return { error: error.message }
  return { ok: true }
}

/**
 * Delete one of the caller's own trades.
 *
 * ── Audit item 15, F4 (P1) ───────────────────────────────────────────────────
 *
 * `trades_delete` was `using (auth.uid() = user_id)` with no source predicate,
 * so a broker-synced or statement-imported trade — whose execution fields the
 * 0028 trigger locks against EDITING, and which `/verification` describes to
 * users as locked — could still simply be removed. Every board metric is
 * recomputed over whatever rows survive (`lib/leaderboard.ts`), so deleting
 * losses raises win rate, profit factor, expectancy and consistency at once,
 * and the MT5 cursor (`last_deal_time`) has already moved past the deleted
 * deal so the next sync will not restore it. Migration 0053 adds
 * `and source = 'manual'` to the policy.
 *
 * The application check below is NOT belt-and-braces for its own sake. A
 * DELETE refused by RLS is SILENT: PostgREST reports success having matched
 * zero rows, so without this read the user would click Delete, see no error,
 * and find the trade still there. The policy is the control; this is the
 * error message.
 */
export async function deleteTrade(tradeId: string): Promise<TradeState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const gate = await allowAction(JOURNAL_BUDGET, user.id)
  if (!gate.ok) return { error: gate.message }

  const { data: t } = await supabase
    .from('trades').select('source').eq('id', tradeId).eq('user_id', user.id).maybeSingle()
  if (!t) return { error: 'Trade not found.' }
  if (t.source !== 'manual') {
    return {
      error: 'Imported trades cannot be deleted. Broker-synced and statement-imported results are a verified record, so they stay as the broker reported them. If a trade is wrong, use the Help button and we will look at it.',
    }
  }

  const { error } = await supabase.from('trades').delete().eq('id', tradeId).eq('user_id', user.id)
  if (error) return { error: error.message }
  revalidatePath('/journal')
  return { ok: true }
}
