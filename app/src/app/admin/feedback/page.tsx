import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/service'
import { FEEDBACK_TYPE_LABELS, type FeedbackType } from '@/lib/feedback'
import { FeedbackStatus } from '../_components/FeedbackStatus'
import { FeedbackCategory, FEEDBACK_CATEGORIES } from '../_components/FeedbackCategory'

type Search = { status?: string; type?: string }

export default async function AdminFeedback({ searchParams }: { searchParams: Promise<Search> }) {
  const { status = 'open', type } = await searchParams
  const svc = createServiceClient()
  let q = svc.from('feedback')
    .select('id, type, message, page_url, status, category, meta, created_at, profiles(username)')
    .order('created_at', { ascending: false })
    .limit(200)
  if (status !== 'all') q = q.eq('status', status)
  if (type) q = q.eq('type', type)
  const { data: rows } = await q

  // Category frequency across everything (not just the filtered view).
  const { data: catRows } = await svc.from('feedback').select('category').not('category', 'is', null)
  const catCounts = new Map<string, number>()
  for (const r of catRows ?? []) catCounts.set(r.category as string, (catCounts.get(r.category as string) ?? 0) + 1)

  const statusTabs = ['open', 'triaged', 'closed', 'all']
  return (
    <div>
      <nav className="ts-nav-links" style={{ gap: 12, marginBottom: 16 }}>
        {statusTabs.map((s) => (
          <Link key={s} className="ts-nav-link" href={`/admin/feedback?status=${s}${type ? `&type=${type}` : ''}`}
            style={{ fontWeight: s === status ? 700 : 400 }}>{s}</Link>
        ))}
      </nav>
      {catCounts.size > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {FEEDBACK_CATEGORIES.filter(([v]) => catCounts.has(v)).map(([v, l]) => (
            <span key={v} className="v-badge">{l}: {catCounts.get(v)}</span>
          ))}
        </div>
      )}
      <div className="ts-card" style={{ padding: 0 }}>
        {(rows ?? []).length === 0 && <p className="faint" style={{ padding: 16 }}>No feedback.</p>}
        {(rows ?? []).map((r) => {
          const profileRaw = r.profiles
          const profileObj = Array.isArray(profileRaw) ? profileRaw[0] : profileRaw
          const username = (profileObj as { username: string } | null)?.username
          return (
            <div key={r.id} className="fb-row" style={{ display: 'grid', gap: 6, padding: 16, borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="eyebrow">{FEEDBACK_TYPE_LABELS[r.type as FeedbackType] ?? r.type}</span>
                {username && <Link className="ts-nav-link" href={`/${username}`}>@{username}</Link>}
                {r.type === 'survey' && (r.meta as { survey?: string })?.survey && (
                  <span className="v-badge">{(r.meta as { survey?: string }).survey}</span>
                )}
                <span className="faint" style={{ fontSize: 12 }}>{new Date(r.created_at).toLocaleString()}</span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  <FeedbackCategory id={r.id} category={r.category} />
                  <FeedbackStatus id={r.id} status={r.status} />
                </span>
              </div>
              <p style={{ whiteSpace: 'pre-wrap' }}>{r.message}</p>
              {r.page_url && <span className="faint" style={{ fontSize: 12 }}>{r.page_url}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
