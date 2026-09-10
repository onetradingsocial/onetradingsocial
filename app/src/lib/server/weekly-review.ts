import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isReviewDecision, type RecordedReview } from '@/lib/basic-review'

/**
 * The last two completed weekly reviews for one user, newest first.
 *
 * Two, because the card shows one of each: this week's row (so a review already
 * recorded reads back as recorded, with a way to change it) and the previous
 * one (so the decision the user made LAST week is on file in front of them
 * while they make this week's — which is the whole reason the decision is
 * stored rather than just displayed).
 *
 * READ ONLY. Nothing on the read path writes a row: the audit is explicit that
 * rendering a summary must not by itself count as a completed review, and
 * `actions/weekly-review.ts` is the only writer.
 *
 * Unrecognised `decision` values are dropped rather than coerced, the same way
 * `getProcessLogs` drops an unrecognised `kind`: 0073's check constraint makes
 * them impossible today, and if a later migration widens the vocabulary this
 * shows less rather than mislabelling a decision the user did not make.
 */
export async function getRecentReviews(
  svc: SupabaseClient, userId: string, limit = 2,
): Promise<RecordedReview[]> {
  const { data } = await svc
    .from('weekly_reviews')
    .select('week_start, window_start, window_end, decision, focus_kind, note, trades_closed, reflected, stood_aside_days')
    .eq('user_id', userId)
    .order('week_start', { ascending: false })
    .limit(limit)

  const out: RecordedReview[] = []
  for (const r of data ?? []) {
    if (!isReviewDecision(r.decision)) continue
    out.push({
      decision: r.decision,
      note: typeof r.note === 'string' && r.note.trim() ? r.note.trim() : null,
      focusKind: typeof r.focus_kind === 'string' ? r.focus_kind : null,
      weekStart: String(r.week_start).slice(0, 10),
      windowFrom: String(r.window_start).slice(0, 10),
      windowTo: String(r.window_end).slice(0, 10),
      tradesClosed: Number(r.trades_closed) || 0,
      reflected: Number(r.reflected) || 0,
      standAsideDays: Number(r.stood_aside_days) || 0,
    })
  }
  return out
}
