'use client'

import { useState, useTransition } from 'react'
import { updateCourse, type CourseInput } from '@/app/actions/admin'

export function CourseEditForm({ id, initial }: { id: string; initial: CourseInput }) {
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, start] = useTransition()
  return (
    <form className="ts-card" style={{ display: 'grid', gap: 8 }}
      onSubmit={(e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        start(async () => {
          setSaved(false); setError(null)
          const res = await updateCourse(id, {
            slug: String(f.get('slug') ?? ''), title: String(f.get('title') ?? ''),
            summary: String(f.get('summary') ?? ''), difficulty: String(f.get('difficulty') ?? ''),
            ord: Number(f.get('ord') ?? 0), minTier: String(f.get('minTier') ?? 'free'),
          })
          if (res.error) setError(res.error); else setSaved(true)
        })
      }}>
      <input name="title" defaultValue={initial.title} required />
      <input name="slug" defaultValue={initial.slug} required />
      <input name="summary" defaultValue={initial.summary} placeholder="Summary" />
      <input name="difficulty" defaultValue={initial.difficulty} placeholder="Difficulty" />
      <input name="ord" type="number" defaultValue={initial.ord} min={0} aria-label="Order" />
      <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
        Min tier
        <select name="minTier" defaultValue={initial.minTier ?? 'free'}>
          <option value="free">Free</option>
          <option value="trader">Trader</option>
          <option value="pro">Pro</option>
        </select>
      </label>
      {error && <span style={{ color: 'var(--danger, #e5484d)' }}>{error}</span>}
      {saved && <span className="faint">Saved.</span>}
      <button className="btn btn-primary btn-sm" disabled={pending} type="submit">Save course</button>
    </form>
  )
}
