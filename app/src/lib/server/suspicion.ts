import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Suspicious-data detection (Sprint 2, row 5). Heuristics run over all trades
 * and surface accounts for ADMIN REVIEW — nothing is auto-flagged publicly.
 * Beta-scale implementation: fetch + compute in process; move to SQL when
 * trade volume demands it.
 *
 * ── Audit item 15, F9 (P2) — what changed and what deliberately did not ──────
 *
 * The audit's charge was that this file "records and displays; it never acts",
 * and that it was blind to the attacks that actually existed. Three of the
 * blind spots are now closed and one is left open on purpose:
 *
 *   + `broker_unbacked` (NEW, and the most important). Nothing anywhere
 *     reconciled `trades.source = 'broker'` against the existence of an active
 *     `broker_accounts` row. Migration 0045 made `source` service-role-only so
 *     the forgery it would have caught is no longer reachable from a client —
 *     but that is exactly why the check is worth having: it is the tripwire
 *     that fires if a future server action reaches for the service client to
 *     "make the insert work" and quietly reopens it. Ten lines for a regression
 *     detector on the platform's central trust claim.
 *
 *   + `deleted_trades` (NEW). F4's other half. Blocking deletion of imported
 *     trades does not stop a manual trader curating their own record, and
 *     `no_losses` cannot see it: it needs >= 10 closed trades and fires only on
 *     a COMPLETE absence of losses, so deleting nine of ten losers is invisible
 *     to it. This reads the `deleted` audit rows — which the WS3 trigger now
 *     writes only when the owning profile still exists, so account deletion no
 *     longer floods this with false positives — and flags a deletion pattern
 *     skewed toward losses.
 *
 *   ~ `profit_spike` now has a fallback. It compared each trade's P&L against
 *     `profiles.account_balance` and did nothing at all when that was 0, which
 *     is 398 of 457 production profiles. It was also comparing a user's numbers
 *     against a figure the same user typed in. The fallback compares a trade
 *     against the user's OWN median trade instead, which they cannot inflate
 *     without inflating the thing being measured.
 *
 *   ~ `is_internal` accounts are no longer dropped on the floor. They are
 *     flagged like everyone else and marked `internal: true` so the admin page
 *     can separate them. 420 of 457 profiles are internal and the seeded data
 *     is exactly what you want to be able to sanity-check.
 *
 *   - NOT DONE, on purpose: automatic consequences. The audit suggested
 *     auto-setting `leaderboard_optout` on a flag. That is a decision to
 *     unpublish a paying customer's results on the strength of a heuristic
 *     with no appeal path and no notification, and `duplicates` alone would
 *     fire on any trader who legitimately scales into a position twice at the
 *     same price. It needs an owner's sign-off and a user-facing notice, not a
 *     subagent's judgement. Flagged in ws5-leaderboard.md under "Needs the
 *     owner".
 */

export type SuspicionKind =
  | 'duplicates'
  | 'impossible_timestamps'
  | 'no_losses'
  | 'profit_spike'
  | 'locked_field_edit'
  | 'broker_unbacked'
  | 'deleted_trades'

export type SuspicionFlag = {
  userId: string
  username: string
  kind: SuspicionKind
  detail: string
  /** True for seeded/team accounts. Kept rather than skipped so the admin page
   *  can show them separately instead of pretending they are clean. */
  internal: boolean
}

type TradeRow = {
  id: string
  user_id: string
  instrument: string
  entry_price: number
  traded_at: string
  closed_at: string | null
  pnl_amount: number | null
  outcome: string
  status: string
  source: string
}

type DeleteAudit = { user_id: string; old_values: Record<string, unknown> | null }

/** How far above the user's own typical trade counts as a spike when there is
 *  no stated balance to compare against. Deliberately loose: this is a "worth a
 *  look" queue, and a real trader letting one winner run 10x their median is
 *  ordinary. 20x is not. */
const SPIKE_MEDIAN_MULTIPLE = 20
/** Below this the median is not a distribution, it is noise. */
const SPIKE_MIN_SAMPLE = 8

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export async function getSuspiciousAccounts(svc: SupabaseClient): Promise<SuspicionFlag[]> {
  const [{ data: trades }, { data: profiles }, { data: audits }, { data: brokers }, { data: deletes }] = await Promise.all([
    svc.from('trades')
      .select('id, user_id, instrument, entry_price, traded_at, closed_at, pnl_amount, outcome, status, source')
      .limit(20000),
    svc.from('profiles').select('id, username, account_balance, is_internal'),
    // Execution fields are DB-locked; any successful user edit on an imported
    // trade means the lock was bypassed somehow — highest-priority flag.
    svc.from('trade_audits')
      .select('user_id, changed_fields, source, actor')
      .eq('action', 'updated')
      .neq('source', 'manual')
      .not('actor', 'is', null)
      .limit(1000),
    svc.from('broker_accounts').select('user_id, status'),
    // `actor` is NOT required to be non-null here, unlike the edit query above:
    // a deletion performed by anything other than the owner's own session is
    // itself the interesting case, not a reason to skip the row.
    svc.from('trade_audits')
      .select('user_id, old_values')
      .eq('action', 'deleted')
      .limit(5000),
  ])

  const names = new Map((profiles ?? []).map((p) => [p.id, p.username]))
  const internal = new Set((profiles ?? []).filter((p) => p.is_internal).map((p) => p.id))
  const balances = new Map((profiles ?? []).map((p) => [p.id, Number(p.account_balance) || 0]))
  const activeBroker = new Set(
    (brokers ?? []).filter((b) => b.status === 'active').map((b) => b.user_id as string),
  )
  const flags: SuspicionFlag[] = []
  const add = (userId: string, kind: SuspicionKind, detail: string) => {
    flags.push({
      userId,
      username: names.get(userId) ?? userId.slice(0, 8),
      kind,
      detail,
      internal: internal.has(userId),
    })
  }

  const byUser = new Map<string, TradeRow[]>()
  for (const t of (trades ?? []) as TradeRow[]) {
    const arr = byUser.get(t.user_id) ?? []
    arr.push(t)
    byUser.set(t.user_id, arr)
  }

  const EXECUTION_JOURNAL_FIELDS = new Set(['note', 'screenshot_url', 'is_public', 'mistake_tags', 'strategy_tags', 'setup_type', 'confidence', 'emotion'])

  for (const [userId, rows] of byUser) {
    // 1) Duplicate trades: identical instrument + entry + open time, entered twice.
    const seen = new Map<string, number>()
    for (const t of rows) {
      const key = `${t.instrument}|${t.entry_price}|${t.traded_at}`
      seen.set(key, (seen.get(key) ?? 0) + 1)
    }
    const dupes = [...seen.values()].filter((n) => n > 1).length
    if (dupes > 0) add(userId, 'duplicates', `${dupes} identical instrument/entry/time combination(s) logged more than once`)

    // 2) Impossible timestamps: closed before opened, or trades from the future.
    const now = Date.now() + 5 * 60 * 1000 // small clock-skew allowance
    const impossible = rows.filter((t) =>
      (t.closed_at && Date.parse(t.closed_at) < Date.parse(t.traded_at)) || Date.parse(t.traded_at) > now,
    ).length
    if (impossible > 0) add(userId, 'impossible_timestamps', `${impossible} trade(s) closed before opening or dated in the future`)

    // 3) Missing losing trades: a meaningful sample with zero losses.
    const closed = rows.filter((t) => t.status === 'closed')
    if (closed.length >= 10 && closed.every((t) => t.outcome !== 'loss')) {
      add(userId, 'no_losses', `${closed.length} closed trades with zero losses`)
    }

    // 4) Abnormal profit spikes.
    //
    // Primary test unchanged: one trade returning more than the whole stated
    // account. Kept because when a balance IS stated it is the sharper signal.
    //
    // Fallback when no balance is stated (398 of 457 production profiles, so
    // this check used to be inert for 87% of accounts): compare against the
    // user's own median absolute P&L. Self-referential on purpose — a user
    // cannot raise this threshold without raising the typical trade it is
    // measured from, whereas the stated balance could be raised in one form
    // submission precisely to suppress this flag (item 15 F3).
    const balance = balances.get(userId) ?? 0
    if (balance > 0) {
      const spikes = closed.filter((t) => (t.pnl_amount ?? 0) > balance).length
      if (spikes > 0) add(userId, 'profit_spike', `${spikes} trade(s) with P/L exceeding the stated account balance ($${balance.toLocaleString()})`)
    } else {
      const mags = closed.map((t) => Math.abs(t.pnl_amount ?? 0)).filter((n) => n > 0)
      const med = median(mags)
      if (mags.length >= SPIKE_MIN_SAMPLE && med > 0) {
        const spikes = closed.filter((t) => Math.abs(t.pnl_amount ?? 0) > med * SPIKE_MEDIAN_MULTIPLE).length
        if (spikes > 0) {
          add(userId, 'profit_spike', `${spikes} trade(s) more than ${SPIKE_MEDIAN_MULTIPLE}x this account's median P/L ($${med.toLocaleString()}); no account balance stated`)
        }
      }
    }

    // 5) Broker-sourced trades with no active broker connection. The single
    //    cross-check the audit found missing, and the one that reconciles the
    //    "Broker connected" badge against the mechanism it claims to represent.
    const brokerRows = rows.filter((t) => t.source === 'broker').length
    if (brokerRows > 0 && !activeBroker.has(userId)) {
      add(userId, 'broker_unbacked', `${brokerRows} trade(s) marked broker-synced with no active broker connection on file`)
    }
  }

  // 6) Deletion patterns. Counted from the audit trail rather than the trades
  //    table, which by definition no longer holds the rows.
  const delByUser = new Map<string, DeleteAudit[]>()
  for (const d of (deletes ?? []) as DeleteAudit[]) {
    const arr = delByUser.get(d.user_id) ?? []
    arr.push(d)
    delByUser.set(d.user_id, arr)
  }
  for (const [userId, rows] of delByUser) {
    const outcomes = rows.map((d) => String(d.old_values?.outcome ?? ''))
    const losses = outcomes.filter((o) => o === 'loss').length
    const wins = outcomes.filter((o) => o === 'win').length
    // Three is the smallest count where "only losses" is a pattern rather than
    // a coincidence, and the wins comparison is what separates curation from
    // an ordinary tidy-up of mis-entered rows.
    if (losses >= 3 && losses > wins * 2) {
      add(userId, 'deleted_trades', `${losses} losing trade(s) deleted against ${wins} winning — deletion skewed toward losses`)
    }
  }

  for (const a of audits ?? []) {
    const changed = (a.changed_fields as string[]).filter((f) => !EXECUTION_JOURNAL_FIELDS.has(f))
    if (changed.length > 0) {
      add(a.user_id, 'locked_field_edit', `execution fields edited on an imported trade: ${changed.join(', ')}`)
    }
  }

  // Real accounts first: an internal account's flags are a data-quality signal,
  // a real account's are a trust signal, and the admin should not have to scroll
  // past 420 seeded personas to find the one that matters.
  return flags.sort((a, b) => Number(a.internal) - Number(b.internal))
}
