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
    <form className="ts-card" style={{ display: 'grid', gap: 8 }}
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
      <input name="title" defaultValue={initial.title} placeholder="Title" required />
      <input name="slug" defaultValue={initial.slug} placeholder="slug" required />
      <textarea name="body" defaultValue={initial.body} placeholder="Lesson HTML" rows={12} style={{ fontFamily: 'monospace' }} />
      <div style={{ display: 'flex', gap: 8 }}>
        <input name="ord" type="number" defaultValue={initial.ord} min={0} aria-label="Order" />
        <input name="xpReward" type="number" defaultValue={initial.xpReward} min={0} aria-label="XP reward" />
      </div>
      {error && <span style={{ color: 'var(--danger, #e5484d)' }}>{error}</span>}
      {saved && <span className="faint">Saved.</span>}
      <button className="btn btn-primary btn-sm" disabled={pending} type="submit">{lessonId ? 'Save lesson' : 'Create lesson'}</button>
    </form>
  )
}
