import Link from 'next/link'
import { TrackOnMount } from '@/app/_components/TrackOnMount'
import { NextActionPrompt } from './NextActionPrompt'
import {
  REVIEW_DECISION_META,
  type BasicWeekSummary, type RecordedReview, type ReviewFocus,
} from '@/lib/basic-review'

/**
 * The basic weekly review — "what did I do this week, against the focus I
 * chose". Ungated: every tier sees this card.
 *
 * ── Audit 2026-09-05, Wave D6 / follow-up C3 ─────────────────────────────────
 *
 * `WeeklyReviewCard` returns `null` below Trader, so a Free user saw nothing
 * where the review should be and could not close a single improvement cycle.
 * This is that missing step. It does not replace the paid card and does not
 * touch its gate: on Trader+ both render, this one above it.
 *
 * ── What is deliberately NOT here ────────────────────────────────────────────
 *
 * Free gets the inputs to reflection; paid gets the analysis of performance. So
 * there is no net P/L, no win rate, no average R, no best or worst trade, no
 * average winner/loser, no max drawdown, no best/worst strategy, no best
 * session, no costliest mistake and no generated continue/change advice. Every
 * one of those stays in `WeeklyReviewCard` behind the `weekly_review` flag.
 * `lib/basic-review.ts` cannot compute them — it never sees a P/L figure — so
 * adding one here would mean reaching past it, which is the signal that the
 * line is being crossed.
 *
 * The counts below are all real counts. A count of trades closed is a count
 * whether the week made money or lost it, which is the property that lets this
 * card be honest without being an analysis.
 *
 * ── `weekly_review_viewed` ───────────────────────────────────────────────────
 *
 * `emitViewed` is passed by the page and is NOT re-derived here. That event had
 * exactly one emitter — the paid card — so a Free user's review streak and
 * `weekly_reviews` goal were pinned at zero by construction. Emitting it here
 * closes that at the source. The page passes `emitViewed={false}` when the paid
 * card is also rendering, so the journal mounts exactly one emitter at every
 * tier and a Trader+ page view still logs one event, not two.
 *
 * Viewing is not reviewing: this event keeps the meaning it has always had
 * ("the review was put in front of you"). A COMPLETED review — evidence plus a
 * chosen next action — is the `weekly_reviews` row that `NextActionPrompt`
 * writes, and nothing on this read path writes one.
 */

const pct = (v: number) => `${Math.round(v * 100)}%`
const fmtDay = (s: string) => new Date(`${s}T00:00:00.000Z`).toLocaleDateString(undefined, {
  month: 'short', day: 'numeric', timeZone: 'UTC',
})

function Count({ label, value, foot }: { label: string; value: string | number; foot: string }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '10px 14px' }}>
      <div className="faint" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: 20, marginTop: 2 }}>{value}</div>
      <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>{foot}</div>
    </div>
  )
}

export function BasicWeeklyReviewCard({
  summary, focus, thisWeekReview, lastWeekReview, emitViewed,
}: {
  summary: BasicWeekSummary
  /** The user's single standing focus, or null when none is set. */
  focus: ReviewFocus | null
  /** The row already recorded for the current ISO week, if any. */
  thisWeekReview: RecordedReview | null
  /** The most recent row from an EARLIER week, if any. */
  lastWeekReview: RecordedReview | null
  emitViewed: boolean
}) {
  const { counts } = summary
  const range = `${fmtDay(summary.window.from)} – ${fmtDay(summary.window.to)}`

  const header = (
    <>
      {emitViewed && <TrackOnMount event="weekly_review_viewed" />}
      <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <h2 className="ts-h2">Your week in review</h2>
        <span className="faint" style={{ fontSize: 12 }}>Free, on every plan · {range}</span>
      </div>
    </>
  )

  // The genuinely empty week: nothing traded, nothing answered, and no day
  // recorded as a deliberate stand-aside. Note what does NOT reach here — a week
  // with no trades but a rest day in it is a COMPLETE week and falls through to
  // the full card, which says so in as many words. Deciding otherwise would
  // reintroduce the assumption migration 0070 exists to remove: that a week only
  // counts if you had a position on.
  if (summary.isEmpty) {
    return (
      <div className="ts-card">
        {header}
        <p className="faint mt-3" style={{ fontSize: 13.5, lineHeight: 1.6, maxWidth: 620 }}>
          <b style={{ display: 'block', color: 'var(--text)' }}>Nothing recorded for this week yet.</b>
          No closed trades dated in the last 7 days, no reflections answered, and no
          day marked as a deliberate stand-aside. There is nothing here to review —
          not a bad week, an unrecorded one.
        </p>
        <ul className="faint mt-3" style={{ fontSize: 13.5, lineHeight: 1.7, paddingLeft: 18, margin: 0, maxWidth: 620 }}>
          <li>
            <Link href="#reflect" style={{ color: 'var(--violet-br)', fontWeight: 700 }}>Answer a reflection</Link>
            {' '}on an older trade — the question is about the trade, not about the week it fell in.
          </li>
          <li>
            Sat out on purpose? Record it as a planned no-trade or a rest day below.
            That is a result, and next week&apos;s review counts it as one.
          </li>
        </ul>
        {lastWeekReview && <LastWeek review={lastWeekReview} />}
      </div>
    )
  }

  return (
    <div className="ts-card">
      {header}
      <p className="ts-sub mt-1">
        What you did, against the focus you chose. Counts only — how the week
        performed is a separate question and a separate card.
      </p>

      {/* The focus, named. Progress is the process figure the Goals card already
          shows at every tier (a share of days journalled, of trades that met
          your own rules, and so on) — it is not a P/L figure and is not one
          here either. */}
      <div className="mt-3" style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '10px 14px' }}>
        <div className="faint" style={{ fontSize: 12 }}>Your focus</div>
        {focus ? (
          <div style={{ fontWeight: 700, marginTop: 3 }}>
            {focus.label}{' '}
            <span className="faint" style={{ fontWeight: 400 }}>
              — {focus.current}{focus.unit} of {focus.target}{focus.unit}
            </span>
          </div>
        ) : (
          <div style={{ marginTop: 3, fontSize: 13.5 }}>
            You have no focus set, so there is nothing to keep, revise or retire yet.{' '}
            <Link href="#process-goals" style={{ color: 'var(--violet-br)', fontWeight: 700 }}>
              Set one below
            </Link>{' '}
            — one standing focus is free.
          </div>
        )}
      </div>

      {summary.restOnly && (
        <p className="mt-3" style={{ fontSize: 13.5, lineHeight: 1.6, maxWidth: 620, borderRadius: 12, padding: '10px 14px', background: 'var(--up-soft)' }}>
          <b>You traded nothing this week, on purpose.</b>{' '}
          {summary.standAsideDays} {summary.standAsideDays === 1 ? 'day' : 'days'} recorded as a
          planned no-trade or rest. That is a complete week, not a gap — nothing below is missing.
        </p>
      )}

      <div className="ts-grid3 mt-3">
        <Count
          label="Trades closed"
          value={summary.tradesClosed}
          foot="closed · trade date in last 7 days"
        />
        <Count
          label="Reflections recorded"
          value={counts.total > 0 ? `${counts.reflected} of ${counts.total}` : counts.reflected}
          foot="answered · this week's closed trades"
        />
        <Count
          label="Days stood aside"
          value={summary.standAsideDays}
          foot="planned no-trade or rest · a result, not a gap"
        />
      </div>

      {/* The four buckets, side by side and always all four. `unreflected` is
          shown next to the rest for the reason the reflect card shows it: a
          compliance figure printed without its denominator is the defect the
          audit named, and the denominator here is `reflected`, never `total`. */}
      <div className="ts-reflect-tally mt-3">
        <span>{counts.followed} followed the rules</span>
        <span>{counts.broke} broke a rule</span>
        <span>{counts.unsure} not sure</span>
        <span className="faint">{counts.unreflected} not yet answered</span>
      </div>
      <p className="faint mt-2" style={{ fontSize: 12.5, maxWidth: 620 }}>
        {summary.followedRate == null
          ? counts.total > 0
            ? 'You have not answered any of this week’s trades yet, so there is no followed rate to show — not 0%, none.'
            : 'No closed trades this week, so there was nothing to answer.'
          : `${pct(summary.followedRate)} of the ${counts.reflected} ${counts.reflected === 1 ? 'trade' : 'trades'} you answered followed your rules${counts.unreflected > 0 ? ` · ${counts.unreflected} still unanswered and not counted either way` : ''}.`}
      </p>

      {focus ? (
        <NextActionPrompt
          focusKind={focus.kind}
          focusLabel={focus.label}
          existing={thisWeekReview}
        />
      ) : (
        <p className="faint mt-4" style={{ fontSize: 12.5 }}>
          The next action — keep, revise or retire — needs a focus to be about.
          Set one and it appears here next week.
        </p>
      )}

      {lastWeekReview && <LastWeek review={lastWeekReview} />}
    </div>
  )
}

/**
 * Last week's decision, on file. The point of storing the decision rather than
 * just showing it: a review you cannot compare against the last one is a
 * snapshot, and the audit asks for a cycle.
 */
function LastWeek({ review }: { review: RecordedReview }) {
  return (
    <p className="faint mt-3" style={{ fontSize: 12.5, maxWidth: 620 }}>
      Week of {fmtDay(review.weekStart)}, you chose to{' '}
      <b style={{ color: 'var(--text)' }}>{REVIEW_DECISION_META[review.decision].short.toLowerCase()}</b>{' '}
      your focus — over {review.tradesClosed} closed{' '}
      {review.tradesClosed === 1 ? 'trade' : 'trades'}, {review.reflected} answered
      {review.standAsideDays > 0 && `, ${review.standAsideDays} ${review.standAsideDays === 1 ? 'day' : 'days'} stood aside`}.
      {review.note && <> &ldquo;{review.note}&rdquo;</>}
    </p>
  )
}
