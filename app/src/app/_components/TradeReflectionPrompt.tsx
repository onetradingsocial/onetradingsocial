'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveTradeReflection, clearTradeReflection } from '@/app/actions/reflection'
import {
  TRADE_REFLECTION_CHOICES, TRADE_REFLECTION_META, REFLECTION_QUESTION,
  REFLECTION_NOTE_MAX, type ReflectionOutcome, type TradeReflection,
} from '@/lib/reflection'

/**
 * "Did this trade follow your rules?" — the third step of the improvement
 * cycle, asked about the trade in front of the user.
 *
 * ── Ungated ──────────────────────────────────────────────────────────────────
 *
 * Every tier, every trade, imported ones included. No `canFlag` call reaches
 * this component and none should: a Free user who cannot reflect cannot
 * complete a cycle.
 *
 * ── The sentence is not the note ─────────────────────────────────────────────
 *
 * The optional line here is `reflection_note`, a short ungated field. It is NOT
 * `trades.note`, which is the private journal note and a Trader perk. They are
 * separate in the schema and they are kept visibly separate here — this control
 * never renders inside the edit form, and its placeholder asks for one line
 * about the rule, not for a journal entry.
 *
 * ── Skipping is not a failure state ──────────────────────────────────────────
 *
 * There is no "you must answer" anywhere. "Not sure" is a real answer, and
 * declining to answer at all leaves the trade unreflected with no penalty on
 * any streak, quest or score. `onSkip` simply dismisses.
 *
 * ── Awaiting the action ──────────────────────────────────────────────────────
 *
 * Every call is awaited inside an async transition callback (CLAUDE.md). A
 * synchronous callback returns before the action settles, so React closes the
 * transition immediately: the buttons never really disable, the router may not
 * apply the revalidated tree, and the write can silently fail to land. That is
 * the feedback-triage bug and it is not repeated here.
 */

export function TradeReflectionPrompt({
  tradeId, current, onSkip, skipLabel = 'Skip', heading = REFLECTION_QUESTION, subtle = false,
}: {
  tradeId: string
  current: TradeReflection | null
  /** Rendered only when provided — the journal card has nothing to dismiss to. */
  onSkip?: () => void
  skipLabel?: string
  heading?: string
  /** Row-level placement: drops the heading chrome down a size. */
  subtle?: boolean
}) {
  const router = useRouter()
  const [chosen, setChosen] = useState<ReflectionOutcome | null>(current?.outcome ?? null)
  const [note, setNote] = useState(current?.note ?? '')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [pending, start] = useTransition()

  function run(fn: () => Promise<{ error?: string }>, after: () => void) {
    setError('')
    start(async () => {
      const res = await fn()
      if (res?.error) {
        setError(res.error)
        // Put the control back to the value the server still holds. A returned
        // error is only an improvement if the caller reads it (CLAUDE.md).
        setChosen(current?.outcome ?? null)
        setNote(current?.note ?? '')
        return
      }
      after()
      router.refresh()
    })
  }

  function choose(outcome: ReflectionOutcome) {
    // Second press on the current answer withdraws it. Three one-click buttons
    // with no undo is a control you can get permanently wrong by mis-tapping.
    if (chosen === outcome) {
      setChosen(null)
      run(() => clearTradeReflection(tradeId), () => { setNote(''); setSaved(false) })
      return
    }
    setChosen(outcome)
    // The answer saves on the press. The sentence is optional and saves after
    // it, so a user who taps and walks away has still recorded the reflection.
    run(() => saveTradeReflection(tradeId, { outcome, note }), () => setSaved(true))
  }

  function saveNote() {
    if (!chosen) return
    run(() => saveTradeReflection(tradeId, { outcome: chosen, note }), () => setSaved(true))
  }

  const noteChanged = chosen != null && note.trim() !== (current?.note ?? '')

  return (
    <div className="ts-reflect" data-subtle={subtle || undefined}>
      <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <b style={{ fontSize: subtle ? 13 : 15 }}>{heading}</b>
        {saved && !pending && <span className="faint" style={{ fontSize: 12 }}>Saved</span>}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        {TRADE_REFLECTION_CHOICES.map((o) => {
          const selected = chosen === o
          return (
            <button
              key={o}
              type="button"
              className="btn btn-sm"
              onClick={() => choose(o)}
              disabled={pending}
              aria-pressed={selected}
              title={TRADE_REFLECTION_META[o].hint}
              style={{
                borderColor: selected ? 'var(--up)' : undefined,
                fontWeight: selected ? 700 : undefined,
                opacity: pending ? 0.6 : 1,
              }}
            >
              <span aria-hidden style={{ marginRight: 6 }}>{TRADE_REFLECTION_META[o].icon}</span>
              {TRADE_REFLECTION_META[o].label}
            </button>
          )
        })}
      </div>

      {chosen && (
        <div style={{ marginTop: 10 }}>
          <label className="ts-field">
            <span className="ts-label">One line about the rule (optional)</span>
            <input
              className="ts-input"
              value={note}
              maxLength={REFLECTION_NOTE_MAX}
              placeholder="e.g. moved my stop after entry"
              onChange={(e) => { setNote(e.target.value); setSaved(false) }}
              onBlur={() => { if (noteChanged) saveNote() }}
              disabled={pending}
            />
          </label>
          <div className="flex items-center justify-between" style={{ gap: 8, marginTop: 6 }}>
            <span className="faint" style={{ fontSize: 11 }}>
              Separate from your private trade notes. {REFLECTION_NOTE_MAX - note.length} characters left.
            </span>
            {noteChanged && (
              <button type="button" className="btn btn-sm" onClick={saveNote} disabled={pending}>
                {pending ? 'Saving…' : 'Save line'}
              </button>
            )}
          </div>
        </div>
      )}

      {error && <p className="ts-error mt-2">{error}</p>}

      {onSkip && (
        <div style={{ marginTop: 10 }}>
          <button type="button" className="btn btn-sm" onClick={onSkip} disabled={pending}>
            {chosen ? 'Done' : skipLabel}
          </button>
          {!chosen && (
            <span className="faint" style={{ fontSize: 11, marginLeft: 8 }}>
              Skipping costs you nothing — no streak, quest or score moves either way.
            </span>
          )}
        </div>
      )}
    </div>
  )
}
