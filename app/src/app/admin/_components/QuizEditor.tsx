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
    <div className="ts-card" style={{ display: 'grid', gap: 12 }}>
      <strong>Quiz</strong>
      {questions.map((q, qi) => (
        <div key={qi} className="quiz-q-edit" style={{ display: 'grid', gap: 6, padding: 10, border: '1px solid var(--border)', borderRadius: 8 }}>
          <input value={q.prompt} placeholder="Question prompt"
            onChange={(e) => update((qs) => { qs[qi].prompt = e.target.value; return qs })} />
          {q.options.map((o, oi) => (
            <div key={oi} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="radio" name={`correct-${qi}`} checked={o.isCorrect}
                onChange={() => update((qs) => { qs[qi].options = qs[qi].options.map((x, i) => ({ ...x, isCorrect: i === oi })); return qs })} />
              <input value={o.label} placeholder={`Option ${oi + 1}`} style={{ flex: 1 }}
                onChange={(e) => update((qs) => { qs[qi].options[oi].label = e.target.value; return qs })} />
              <button type="button" className="btn btn-sm"
                onClick={() => update((qs) => { qs[qi].options.splice(oi, 1); return qs })}>×</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-sm"
              onClick={() => update((qs) => { qs[qi].options.push({ label: '', isCorrect: false }); return qs })}>+ Option</button>
            <button type="button" className="btn btn-sm"
              onClick={() => update((qs) => { qs.splice(qi, 1); return qs })}>Remove question</button>
          </div>
        </div>
      ))}
      <button type="button" className="btn btn-sm"
        onClick={() => update((qs) => { qs.push({ prompt: '', options: [{ label: '', isCorrect: true }, { label: '', isCorrect: false }] }); return qs })}>+ Question</button>
      {error && <span style={{ color: 'var(--danger, #e5484d)' }}>{error}</span>}
      {saved && <span className="faint">Quiz saved.</span>}
      <button type="button" className="btn btn-primary btn-sm" disabled={pending}
        onClick={() => start(async () => { setSaved(false); setError(null); const r = await setLessonQuiz(lessonId, questions); if (r.error) setError(r.error); else setSaved(true) })}>
        Save quiz
      </button>
    </div>
  )
}
