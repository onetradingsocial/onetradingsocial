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
      className="ad-panel"
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
      <div className="ad-panel-head"><span className="t">New course</span></div>
      <div className="ad-panel-body">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <label className="ts-field">
            <span className="ts-label">Title</span>
            <input className="ts-input" name="title" placeholder="Risk management basics" required />
          </label>
          <label className="ts-field">
            <span className="ts-label">Slug</span>
            <input className="ts-input" name="slug" placeholder="slug-like-this" required />
          </label>
          <label className="ts-field" style={{ gridColumn: '1 / -1' }}>
            <span className="ts-label">Summary</span>
            <input className="ts-input" name="summary" placeholder="One sentence shown on the hub card" />
          </label>
          <label className="ts-field">
            <span className="ts-label">Difficulty</span>
            <input className="ts-input" name="difficulty" placeholder="beginner / intermediate / advanced" />
          </label>
          <label className="ts-field">
            <span className="ts-label">Order</span>
            <input className="ts-input" name="ord" type="number" defaultValue={0} min={0} />
          </label>
          <label className="ts-field">
            <span className="ts-label">Min tier</span>
            <select className="ts-select" name="minTier" defaultValue="free">
              <option value="free">Free</option>
              <option value="trader">Trader</option>
              <option value="pro">Pro</option>
            </select>
          </label>
        </div>
        {error && <span style={{ color: 'var(--down)', fontSize: 13 }}>{error}</span>}
        <div>
          <button className="btn btn-primary btn-sm" disabled={pending} type="submit">
            {pending ? 'Creating…' : 'Create course'}
          </button>
        </div>
      </div>
    </form>
  )
}
