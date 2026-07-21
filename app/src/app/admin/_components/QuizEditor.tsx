'use client'

import { useState, useTransition } from 'react'
import { setLessonQuiz, type QuestionInput } from '@/app/actions/admin'

export function QuizEditor({ lessonId, initial }: { lessonId: string; initial: QuestionInput[] }) {
  const [questions, setQuestions] = useState<QuestionInput[]>(initial)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, start] = useTransition()

  const update = (fn: (qs: QuestionInput[]) => QuestionInput[]) => setQuestions((qs) => fn(structuredClone(qs)))

  return (
    <div className="ad-panel">
      <div className="ad-panel-head">
        <span className="t">Quiz</span>
        <span className="r ad-kv">{questions.length} question{questions.length === 1 ? '' : 's'}</span>
      </div>
      <div className="ad-panel-body" style={{ gap: 12 }}>
        {questions.length === 0 && (
          <p className="faint" style={{ fontSize: 13, margin: 0 }}>
            No questions yet. A lesson without a quiz still awards XP on completion.
          </p>
        )}

        {questions.map((q, qi) => (
          <div
            key={qi}
            style={{ display: 'grid', gap: 8, padding: 14, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface-2)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span className="ad-kv" style={{ color: 'var(--faintest)' }}>Q{qi + 1}</span>
              <input
                className="ts-input" value={q.prompt} placeholder="Question prompt"
                style={{ height: 40, background: 'var(--surface)' }}
                onChange={(e) => update((qs) => { qs[qi].prompt = e.target.value; return qs })}
              />
            </div>

            <div style={{ display: 'grid', gap: 6, paddingLeft: 28 }}>
              {q.options.map((o, oi) => (
                <div key={oi} style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
                  <input
                    type="radio" name={`correct-${qi}`} checked={o.isCorrect}
                    title="Mark as the correct answer"
                    style={{ width: 15, height: 15, accentColor: 'var(--up)', flex: 'none', cursor: 'pointer' }}
                    onChange={() => update((qs) => { qs[qi].options = qs[qi].options.map((x, i) => ({ ...x, isCorrect: i === oi })); return qs })}
                  />
                  <input
                    className="ts-input" value={o.label} placeholder={`Option ${oi + 1}`}
                    style={{ height: 38, fontSize: 14, background: 'var(--surface)' }}
                    onChange={(e) => update((qs) => { qs[qi].options[oi].label = e.target.value; return qs })}
                  />
                  <button
                    type="button" className="btn btn-ghost btn-sm" title="Remove option"
                    style={{ height: 38, padding: '0 11px', flex: 'none' }}
                    onClick={() => update((qs) => { qs[qi].options.splice(oi, 1); return qs })}
                  >×</button>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, paddingLeft: 28 }}>
              <button
                type="button" className="btn btn-ghost btn-sm"
                onClick={() => update((qs) => { qs[qi].options.push({ label: '', isCorrect: false }); return qs })}
              >+ Option</button>
              <button
                type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--down)' }}
                onClick={() => update((qs) => { qs.splice(qi, 1); return qs })}
              >Remove question</button>
            </div>
          </div>
        ))}

        <div>
          <button
            type="button" className="btn btn-ghost btn-sm"
            onClick={() => update((qs) => { qs.push({ prompt: '', options: [{ label: '', isCorrect: true }, { label: '', isCorrect: false }] }); return qs })}
          >+ Question</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <button
            type="button" className="btn btn-primary btn-sm" disabled={pending}
            onClick={() => start(async () => {
              setSaved(false); setError(null)
              const r = await setLessonQuiz(lessonId, questions)
              if (r.error) setError(r.error); else setSaved(true)
            })}
          >
            {pending ? 'Saving…' : 'Save quiz'}
          </button>
          {error && <span style={{ color: 'var(--down)', fontSize: 13 }}>{error}</span>}
          {saved && <span className="v-badge vb-broker">Saved</span>}
        </div>
      </div>
    </div>
  )
}
