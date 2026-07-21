'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createLesson, updateLesson, type LessonInput } from '@/app/actions/admin'

export function LessonEditForm({ courseId, lessonId, initial }: {
  courseId: string; lessonId?: string; initial: LessonInput
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, start] = useTransition()
  return (
    <form className="ad-panel"
      onSubmit={(e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        const input: LessonInput = {
          slug: String(f.get('slug') ?? ''), title: String(f.get('title') ?? ''),
          body: String(f.get('body') ?? ''), ord: Number(f.get('ord') ?? 0),
          xpReward: Number(f.get('xpReward') ?? 0),
        }
        start(async () => {
          setSaved(false); setError(null)
          const res = lessonId ? await updateLesson(lessonId, input) : await createLesson(courseId, input)
          if (res.error) setError(res.error)
          else if (!lessonId && 'id' in res && res.id) router.push(`/admin/courses/${courseId}/lessons/${res.id}`)
          else setSaved(true)
        })
      }}>
      <div className="ad-panel-head"><span className="t">{lessonId ? 'Lesson content' : 'New lesson'}</span></div>
      <div className="ad-panel-body">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <label className="ts-field">
            <span className="ts-label">Title</span>
            <input className="ts-input" name="title" defaultValue={initial.title} required />
          </label>
          <label className="ts-field">
            <span className="ts-label">Slug</span>
            <input className="ts-input" name="slug" defaultValue={initial.slug} required />
          </label>
          <label className="ts-field">
            <span className="ts-label">Order</span>
            <input className="ts-input" name="ord" type="number" defaultValue={initial.ord} min={0} />
          </label>
          <label className="ts-field">
            <span className="ts-label">XP reward</span>
            <input className="ts-input" name="xpReward" type="number" defaultValue={initial.xpReward} min={0} />
          </label>
        </div>
        <label className="ts-field">
          <span className="ts-label">Body (HTML)</span>
          <textarea
            className="ts-textarea" name="body" defaultValue={initial.body} rows={16}
            placeholder="<p>Lesson HTML…</p>"
            style={{ fontFamily: 'var(--mono)', fontSize: 13, lineHeight: 1.6 }}
          />
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-primary btn-sm" disabled={pending} type="submit">
            {pending ? 'Saving…' : lessonId ? 'Save lesson' : 'Create lesson'}
          </button>
          {error && <span style={{ color: 'var(--down)', fontSize: 13 }}>{error}</span>}
          {saved && <span className="v-badge vb-broker">Saved</span>}
        </div>
      </div>
    </form>
  )
}
