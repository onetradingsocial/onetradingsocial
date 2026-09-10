'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { allowAction, JOURNAL_BUDGET } from '@/lib/server/action-throttle'
import { getProcessLogs } from '@/lib/server/process'
import { isReviewDecision, normalizeReviewNote, summarizeBasicWeek, utcWeekStart } from '@/lib/basic-review'

/**
 * Recording a completed weekly review — the evidence considered, and the next
 * action chosen for the focus.
 *
 * ── Audit 2026-09-05, Wave D6 / follow-up C3 ─────────────────────────────────
 *
 * Ungated by plan, by the precedent `actions/process.ts` and
 * `actions/reflection.ts` both set: the review is the step that CLOSES the
 * basic cycle, and a cycle a Free user cannot close is not a cycle. No plan
 * gate is read, added or moved in this file — `weekly_review` (the flag on the
 * Trader+ performance card) is not consulted here and is deliberately not
 * imported.
 *
 * ── Rendering is not reviewing ───────────────────────────────────────────────
 *
 * The audit asks that rendering a summary must not by itself count as a
 * completed review, so this action is the ONLY thing that writes a
 * `weekly_reviews` row. The read path touches the table and never inserts into
 * it.
 *
 * ── The evidence is re-derived here, not accepted from the client ────────────
 *
 * The caller sends a decision and at most one sentence. Everything else — the
 * trades closed in the window, the four reflection buckets, the days stood
 * aside — is recomputed from the database by this function and written with the
 * service client, because migration 0073 grants the client no INSERT or UPDATE
 * on the table at all. A user can decide anything they like about their own
 * focus; they cannot author the evidence the decision is stored against.
 *
 * ── Nothing here touches a reward count ──────────────────────────────────────
 *
 * No analytics event is emitted and no `process_logs` row is written. The
 * `weekly_reviews` goal and the review streak read two sources already
 * (`weekly_review_viewed` and `process_logs.kind = 'review'`), de-duplicated by
 * day in `lib/server/goals.ts`; a third writer here would turn one review into
 * two counted days for the users who use this feature most. See the comment in
 * that file.
 */

export type WeeklyReviewState = { error?: string; ok?: boolean }

const DAY_MS = 864e5

export async function recordWeeklyReview(input: {
  decision: string
  note?: string | null
  focusKind?: string | null
}): Promise<WeeklyReviewState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const gate = await allowAction(JOURNAL_BUDGET, user.id)
  if (!gate.ok) return { error: gate.message }

  if (!isReviewDecision(input.decision)) return { error: 'Pick keep, revise or retire.' }
  const note = normalizeReviewNote(input.note)
  // The focus is a label for history, not an authorisation. It is stored as
  // free text with no FK precisely so a review that RETIRED a focus survives
  // the goal row it retired — but it is still bounded so a caller cannot use it
  // as an unbounded text column beside the capped one.
  const focusKind = typeof input.focusKind === 'string' && input.focusKind.length <= 64
    ? input.focusKind
    : null

  const now = Date.now()
  const svc = createServiceClient()

  // Re-derive the evidence. Same window and same population the card counted:
  // the window's CLOSED trades from the user's full list, never the page's
  // Free-capped visible slice — a review of "this week" that silently omits
  // this week's trades on an account with more than 30 of them is worse than no
  // review at all.
  const windowStartMs = now - 7 * DAY_MS
  const [{ data: rows }, logs] = await Promise.all([
    svc.from('trades')
      .select('traded_at, status, reflection_outcome, reflection_note')
      .eq('user_id', user.id)
      .eq('status', 'closed')
      .gte('traded_at', new Date(windowStartMs).toISOString()),
    getProcessLogs(supabase, user.id),
  ])
  const closedThisWeek = (rows ?? []).filter((t) => {
    const ms = Date.parse(t.traded_at as string)
    return ms >= windowStartMs && ms < now
  })
  const summary = summarizeBasicWeek({ closedThisWeek, logs, now })

  const payload = {
    user_id: user.id,
    decision: input.decision,
    focus_kind: focusKind,
    note,
    window_start: summary.window.from,
    window_end: summary.window.to,
    trades_closed: summary.tradesClosed,
    reflected: summary.counts.reflected,
    followed: summary.counts.followed,
    broke: summary.counts.broke,
    unsure: summary.counts.unsure,
    unreflected: summary.counts.unreflected,
    stood_aside_days: summary.standAsideDays,
  }

  // Insert-then-amend rather than upsert, for the reason `logProcess` gives:
  // `week_start` is server-defaulted and must stay that way, and an upsert's
  // ON CONFLICT DO UPDATE would want the conflict target — which is the very
  // column the client is not allowed to choose. Re-deciding inside the same ISO
  // week amends the row: a trader who changes their mind on Thursday has done
  // one review, not two.
  const { error } = await svc.from('weekly_reviews').insert(payload)
  if (error) {
    // 23505 = weekly_reviews_user_week_uidx: already reviewed this week.
    if (error.code !== '23505') return { error: 'Could not save that.' }
    const { user_id: _omit, ...amend } = payload
    void _omit
    const { error: updErr } = await svc
      .from('weekly_reviews').update(amend)
      .eq('user_id', user.id).eq('week_start', utcWeekStart(now))
    if (updErr) return { error: 'Could not save that.' }
  }

  revalidatePath('/journal')
  return { ok: true }
}
