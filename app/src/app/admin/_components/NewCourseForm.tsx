'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createCourse } from '@/app/actions/admin'

export function NewCourseForm() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  return (
    <form
      className="ts-card mt-4"
      style={{ display: 'grid', gap: 8 }}
      onSubmit={(e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        start(async () => {
          const res = await createCourse({
            slug: String(f.get('slug') ?? ''), title: String(f.get('title') ?? ''),
            summary: String(f.get('summary') ?? ''), difficulty: String(f.get('difficulty') ?? ''),
            ord: Number(f.get('ord') ?? 0), minTier: String(f.get('minTier') ?? 'free'),
          })
          if (res.error) setError(res.error)
          else if (res.id) router.push(`/admin/courses/${res.id}`)
        })
      }}
    >
      <strong>New course</strong>
      <input name="title" placeholder="Title" required />
      <input name="slug" placeholder="slug-like-this" required />
      <input name="summary" placeholder="Summary" />
      <input name="difficulty" placeholder="beginner / intermediate / advanced" />
      <input name="ord" type="number" defaultValue={0} min={0} aria-label="Order" />
      <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
        Min tier
        <select name="minTier" defaultValue="free">
          <option value="free">Free</option>
          <option value="trader">Trader</option>
          <option value="pro">Pro</option>
        </select>
      </label>
      {error && <span style={{ color: 'var(--danger, #e5484d)' }}>{error}</span>}
      <button className="btn btn-primary btn-sm" disabled={pending} type="submit">Create</button>
    </form>
  )
}
