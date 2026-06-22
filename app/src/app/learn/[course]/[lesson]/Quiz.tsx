'use client'

import { useState } from 'react'
import { submitQuiz, type QuizResult } from '@/app/actions/learning'

type Q = { id: string; prompt: string; options: { id: string; label: string }[] }

export function Quiz({ lessonId, questions, alreadyDone }: { lessonId: string; questions: Q[]; alreadyDone: boolean }) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [result, setResult] = useState<QuizResult | null>(null)
  const [busy, setBusy] = useState(false)

  if (alreadyDone && !result) {
    return <div className="ts-card quiz-done">✓ You’ve completed this lesson.</div>
  }

  const allAnswered = questions.every((q) => answers[q.id])
  const wrong = new Set(result?.wrongQuestionIds ?? [])

  async function onSubmit() {
    setBusy(true)
    const r = await submitQuiz(lessonId, answers)
    setResult(r)
    setBusy(false)
  }

  if (result?.passed) {
    return <div className="ts-card quiz-pass">🎉 Passed!{result.xpAwarded > 0 ? ` +${result.xpAwarded} XP` : ' (already completed)'}</div>
  }

  return (
    <div className="ts-card quiz">
      <h2 className="ts-h2">Quiz</h2>
      {result && !result.passed && <p className="quiz-fail mt-3">Not quite — review the highlighted questions and try again.</p>}
      {questions.map((q, i) => (
        <fieldset key={q.id} className={'quiz-q' + (wrong.has(q.id) ? ' wrong' : '')}>
          <legend>{i + 1}. {q.prompt}</legend>
          {q.options.map((o) => (
            <label key={o.id} className="quiz-opt">
              <input type="radio" name={q.id} value={o.id} checked={answers[q.id] === o.id}
                onChange={() => setAnswers((a) => ({ ...a, [q.id]: o.id }))} />
              <span>{o.label}</span>
            </label>
          ))}
        </fieldset>
      ))}
      <button className="btn btn-primary mt-3" disabled={!allAnswered || busy} onClick={onSubmit}>
        {busy ? 'Checking…' : 'Submit answers'}
      </button>
    </div>
  )
}
