'use client'

import { useState, useTransition } from 'react'
import { updateCourse, type CourseInput } from '@/app/actions/admin'

export function CourseEditForm({ id, initial }: { id: string; initial: CourseInput }) {
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, start] = useTransition()
  return (
    <form className="ad-panel"
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
      <div className="ad-panel-head"><span className="t">Course details</span></div>
      <div className="ad-panel-body">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <label className="ts-field">
            <span className="ts-label">Title</span>
            <input className="ts-input" name="title" defaultValue={initial.title} required />
          </label>
          <label className="ts-field">
            <span className="ts-label">Slug</span>
            <input className="ts-input" name="slug" defaultValue={initial.slug} required />
          </label>
          <label className="ts-field" style={{ gridColumn: '1 / -1' }}>
            <span className="ts-label">Summary</span>
            <input className="ts-input" name="summary" defaultValue={initial.summary} placeholder="One sentence shown on the hub card" />
          </label>
          <label className="ts-field">
            <span className="ts-label">Difficulty</span>
            <input className="ts-input" name="difficulty" defaultValue={initial.difficulty} placeholder="beginner / intermediate / advanced" />
          </label>
          <label className="ts-field">
            <span className="ts-label">Order</span>
            <input className="ts-input" name="ord" type="number" defaultValue={initial.ord} min={0} />
          </label>
          <label className="ts-field">
            <span className="ts-label">Min tier</span>
            <select className="ts-select" name="minTier" defaultValue={initial.minTier ?? 'free'}>
              <option value="free">Free</option>
              <option value="trader">Trader</option>
              <option value="pro">Pro</option>
            </select>
          </label>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-primary btn-sm" disabled={pending} type="submit">
            {pending ? 'Saving…' : 'Save course'}
          </button>
          {error && <span style={{ color: 'var(--down)', fontSize: 13 }}>{error}</span>}
          {saved && <span className="v-badge vb-broker">Saved</span>}
        </div>
      </div>
    </form>
  )
}
