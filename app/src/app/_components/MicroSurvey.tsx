'use client'

import { useEffect, useState } from 'react'
import { submitFeedback } from '@/app/actions/feedback'
import { track } from '@/lib/track'

/**
 * One-question contextual survey (Sprint 2, row 27). Each key fires at most
 * once per browser (localStorage guard) and stores the answer as feedback
 * type 'survey'. No long forms — one tap and it's gone.
 */
export function MicroSurvey({
  surveyKey, question, options,
}: { surveyKey: string; question: string; options: string[] }) {
  const [visible, setVisible] = useState(false)
  const [sent, setSent] = useState(false)

  useEffect(() => {
    try {
      if (!localStorage.getItem(`ts_survey_${surveyKey}`)) setVisible(true)
    } catch { /* storage blocked -> stay hidden */ }
  }, [surveyKey])

  if (!visible) return null

  async function answer(a: string) {
    setSent(true)
    try { localStorage.setItem(`ts_survey_${surveyKey}`, a) } catch { /* non-fatal */ }
    track('feedback_submitted', { type: 'survey', survey: surveyKey })
    await submitFeedback({
      type: 'survey',
      message: a,
      pageUrl: window.location.href,
      meta: { survey: surveyKey },
    })
    setTimeout(() => setVisible(false), 1400)
  }

  function dismiss() {
    try { localStorage.setItem(`ts_survey_${surveyKey}`, '(dismissed)') } catch { /* non-fatal */ }
    setVisible(false)
  }

  return (
    <div className="ts-card mt-4" style={{ padding: '12px 16px', borderColor: 'var(--border-vio)' }}>
      {sent ? (
        <span style={{ fontSize: 13.5 }}>Thanks — that helps. 🙌</span>
      ) : (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{question}</span>
          <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {options.map((o) => (
              <button key={o} type="button" className="ts-chip" onClick={() => answer(o)}>{o}</button>
            ))}
            <button type="button" aria-label="Dismiss" onClick={dismiss}
              style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: 15, padding: '0 4px' }}>✕</button>
          </span>
        </div>
      )}
    </div>
  )
}
