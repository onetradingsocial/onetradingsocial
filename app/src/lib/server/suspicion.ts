import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Suspicious-data detection (Sprint 2, row 5). Heuristics run over all trades
 * and surface accounts for ADMIN REVIEW — nothing is auto-flagged publicly.
 * Beta-scale implementation: fetch + compute in process; move to SQL when
 * trade volume demands it.
 */

export type SuspicionFlag = {
  userId: string
  username: string
  kind: 'duplicates' | 'impossible_timestamps' | 'no_losses' | 'profit_spike' | 'locked_field_edit'
  detail: string
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

export async function getSuspiciousAccounts(svc: SupabaseClient): Promise<SuspicionFlag[]> {
  const [{ data: trades }, { data: profiles }, { data: audits }] = await Promise.all([
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
  ])

  const names = new Map((profiles ?? []).map((p) => [p.id, p.username]))
  const internal = new Set((profiles ?? []).filter((p) => p.is_internal).map((p) => p.id))
  const balances = new Map((profiles ?? []).map((p) => [p.id, Number(p.account_balance) || 0]))
  const flags: SuspicionFlag[] = []
  const add = (userId: string, kind: SuspicionFlag['kind'], detail: string) => {
    if (internal.has(userId)) return // seeded demo users are synthetic by design
    flags.push({ userId, username: names.get(userId) ?? userId.slice(0, 8), kind, detail })
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

    // 4) Abnormal profit spikes: one trade returning more than the whole account.
    const balance = balances.get(userId) ?? 0
    if (balance > 0) {
      const spikes = closed.filter((t) => (t.pnl_amount ?? 0) > balance).length
      if (spikes > 0) add(userId, 'profit_spike', `${spikes} trade(s) with P/L exceeding the stated account balance ($${balance.toLocaleString()})`)
    }
  }

  for (const a of audits ?? []) {
    const changed = (a.changed_fields as string[]).filter((f) => !EXECUTION_JOURNAL_FIELDS.has(f))
    if (changed.length > 0) {
      add(a.user_id, 'locked_field_edit', `execution fields edited on an imported trade: ${changed.join(', ')}`)
    }
  }

  return flags
}
