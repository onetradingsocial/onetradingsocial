'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { submitFeatureRequest, toggleFeatureVote, commentOnFeature } from '@/app/actions/feature-board'
import { setFeatureStatus } from '@/app/actions/admin'
import { FR_STATUS_LABELS, FR_STATUS_CLASS, FR_STATUSES, type FrStatus } from '@/lib/feature-board'

export type FrItem = {
  id: number
  title: string
  body: string | null
  status: FrStatus
  author: string | null
  votes: number
  voted: boolean
  comments: { author: string | null; body: string; createdAt: string }[]
}

function NewRequest() {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  return (
    <div className="ts-card">
      <h2 className="ts-h2">Request a feature</h2>
      <input className="ts-input mt-3" placeholder="Short, clear title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="ts-textarea mt-3" rows={3} placeholder="What problem would this solve? (optional)" value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} />
      {error && <p className="ts-error mt-2">{error}</p>}
      <button className="btn btn-primary mt-3" disabled={pending || !title.trim()}
        onClick={() => start(async () => {
          const r = await submitFeatureRequest({ title, body })
          if (r.error) { setError(r.error); return }
          setTitle(''); setBody(''); setError(''); router.refresh()
        })}>
        {pending ? 'Submitting…' : 'Submit'}
      </button>
    </div>
  )
}

function Card({ item, isAdmin }: { item: FrItem; isAdmin: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [comment, setComment] = useState('')
  const [pending, start] = useTransition()

  return (
    <div className="ts-card" style={{ display: 'flex', gap: 14 }}>
      <button type="button" aria-label="Vote"
        onClick={() => start(async () => { await toggleFeatureVote(item.id); router.refresh() })}
        style={{
          flexShrink: 0, width: 52, borderRadius: 12, cursor: 'pointer',
          border: `1px solid ${item.voted ? 'var(--violet)' : 'var(--border-2)'}`,
          background: item.voted ? 'rgba(124,92,230,0.10)' : 'var(--surface-2)',
          color: item.voted ? 'var(--violet-deep)' : 'var(--dim)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '8px 0',
        }}>
        <span style={{ fontSize: 14 }}>▲</span>
        <b style={{ fontSize: 16 }}>{item.votes}</b>
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong>{item.title}</strong>
          <span className={`v-badge ${FR_STATUS_CLASS[item.status]}`}>{FR_STATUS_LABELS[item.status]}</span>
        </div>
        {item.body && <p className="faint mt-2" style={{ fontSize: 13.5, whiteSpace: 'pre-wrap' }}>{item.body}</p>}
        <div className="mt-2" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span className="faint" style={{ fontSize: 12 }}>{item.author ? `@${item.author}` : 'Anonymous'}</span>
          <button type="button" onClick={() => setOpen((v) => !v)} style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--violet-br)', fontSize: 12.5, fontWeight: 600 }}>
            {item.comments.length} comment{item.comments.length === 1 ? '' : 's'}
          </button>
          {isAdmin && (
            <select className="ts-select" style={{ width: 'auto', fontSize: 12, padding: '3px 24px 3px 8px' }}
              value={item.status} disabled={pending}
              onChange={(e) => { const s = e.target.value; start(async () => { await setFeatureStatus(item.id, s); router.refresh() }) }}>
              {FR_STATUSES.map((s) => <option key={s} value={s}>{FR_STATUS_LABELS[s]}</option>)}
            </select>
          )}
        </div>

        {open && (
          <div className="mt-3" style={{ display: 'grid', gap: 8 }}>
            {item.comments.map((c, i) => (
              <div key={i} style={{ fontSize: 13, borderLeft: '2px solid var(--border-2)', paddingLeft: 10 }}>
                <span className="faint">{c.author ? `@${c.author}` : 'Anonymous'}</span> · {c.body}
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="ts-input" placeholder="Add a comment" value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} />
              <button className="btn btn-sm" disabled={pending || !comment.trim()}
                onClick={() => start(async () => { await commentOnFeature(item.id, comment); setComment(''); router.refresh() })}>
                Post
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function FeatureBoardClient({ items, isAdmin }: { items: FrItem[]; isAdmin: boolean }) {
  const [filter, setFilter] = useState<FrStatus | 'all'>('all')
  const shown = filter === 'all' ? items : items.filter((i) => i.status === filter)
  return (
    <>
      <NewRequest />
      <div className="mt-4" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="ts-chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}
          style={filter === 'all' ? { borderColor: 'var(--violet)', fontWeight: 700 } : undefined}>All</button>
        {FR_STATUSES.map((s) => (
          <button key={s} type="button" className="ts-chip" aria-pressed={filter === s} onClick={() => setFilter(s)}
            style={filter === s ? { borderColor: 'var(--violet)', fontWeight: 700 } : undefined}>
            {FR_STATUS_LABELS[s]}
          </button>
        ))}
      </div>
      <div className="mt-4" style={{ display: 'grid', gap: 12 }}>
        {shown.length === 0 ? <p className="faint">No requests here yet.</p>
          : shown.map((item) => <Card key={item.id} item={item} isAdmin={isAdmin} />)}
      </div>
    </>
  )
}
