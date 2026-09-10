'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { recordWeeklyReview } from '@/app/actions/weekly-review'
import {
  REVIEW_DECISIONS, REVIEW_DECISION_META, REVIEW_NOTE_MAX,
  type ReviewDecision, type RecordedReview,
} from '@/lib/basic-review'

/**
 * "One next action" — keep, revise or retire the focus, recorded.
 *
 * ── Why a control and not a caption ──────────────────────────────────────────
 *
 * The audit asks a completed review to record the evidence considered AND a
 * chosen next action, and says explicitly that rendering a summary must not by
 * itself count as a completed review. So the review is complete when this
 * button is pressed and not a moment earlier — the card above renders with or
 * without a row here, and reading it writes nothing.
 *
 * ── Ungated ──────────────────────────────────────────────────────────────────
 *
 * No tier prop and no `canFlag`, the same as `TradeReflectionPrompt` and
 * `ProcessLogCard`. This is the step that closes the cycle.
 *
 * ── Awaiting the action ──────────────────────────────────────────────────────
 *
 * The call is awaited inside an async transition callback (CLAUDE.md). A
 * synchronous callback returns before the action settles, so React closes the
 * transition immediately: the buttons never really disable, the router may not
 * apply the revalidated tree, and the write can silently fail to land. That is
 * the feedback-triage bug and it is not repeated here. On a returned `{ error }`
 * the selection is put back to the value the server still holds.
 */
export function NextActionPrompt({ focusKind, focusLabel, existing }: {
  /** The `process_goals.kind` the decision is about, or null when none is set. */
  focusKind: string | null
  focusLabel: string
  /** This week's row, if the user has already decided. */
  existing: RecordedReview | null
}) {
  const router = useRouter()
  const [chosen, setChosen] = useState<ReviewDecision | null>(existing?.decision ?? null)
  const [note, setNote] = useState(existing?.note ?? '')
  const [error, setError] = useState('')
  const [pending, start] = useTransition()

  function save(decision: ReviewDecision, nextNote = note) {
    setError('')
    setChosen(decision)
    start(async () => {
      const res = await recordWeeklyReview({ decision, note: nextNote, focusKind })
      if (res?.error) {
        setError(res.error)
        setChosen(existing?.decision ?? null)
        setNote(existing?.note ?? '')
        return
      }
      router.refresh()
    })
  }

  const noteChanged = chosen != null && note.trim() !== (existing?.note ?? '')

  return (
    <div className="ts-reflect mt-4">
      <b style={{ fontSize: 14 }}>
        Next action for &ldquo;{focusLabel}&rdquo;
      </b>
      <p className="faint" style={{ fontSize: 12.5, margin: '4px 0 0', maxWidth: 620 }}>
        Pick one. It is written down against the counts above, so next week&apos;s
        review opens with the decision you actually made rather than the one you
        remember making.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
        {REVIEW_DECISIONS.map((d) => {
          const selected = chosen === d
          return (
            <button
              key={d}
              type="button"
              className="btn btn-sm"
              onClick={() => save(d)}
              disabled={pending}
              aria-pressed={selected}
              title={REVIEW_DECISION_META[d].hint}
              style={{
                borderColor: selected ? 'var(--up)' : undefined,
                fontWeight: selected ? 700 : undefined,
                opacity: pending ? 0.6 : 1,
              }}
            >
              {REVIEW_DECISION_META[d].label}
            </button>
          )
        })}
      </div>

      {chosen && (
        <div style={{ marginTop: 10 }}>
          <label className="ts-field">
            <span className="ts-label">Why, in a line (optional)</span>
            <input
              className="ts-input"
              value={note}
              maxLength={REVIEW_NOTE_MAX}
              placeholder="e.g. two clean days and one rushed entry — same focus, tighter window"
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => { if (noteChanged) save(chosen, note) }}
              disabled={pending}
            />
          </label>
          <div className="flex items-center justify-between" style={{ gap: 8, marginTop: 6 }}>
            <span className="faint" style={{ fontSize: 11 }}>
              {existing
                ? 'Changing your mind this week amends the same record — it is not a second review.'
                : 'Recorded once a week.'}{' '}
              {REVIEW_NOTE_MAX - note.length} characters left.
            </span>
            {noteChanged && (
              <button type="button" className="btn btn-sm" onClick={() => save(chosen, note)} disabled={pending}>
                {pending ? 'Saving…' : 'Save line'}
              </button>
            )}
          </div>
        </div>
      )}

      {error && <p className="ts-error mt-2">{error}</p>}
    </div>
  )
}
