import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/service'
import { FEEDBACK_TYPE_LABELS, type FeedbackType } from '@/lib/feedback'
import { FeedbackStatus } from '../_components/FeedbackStatus'
import { FeedbackCategory, FEEDBACK_CATEGORIES } from '../_components/FeedbackCategory'
import { Empty, PageHead, Panel, When } from '../_components/ui'

type Search = { status?: string; type?: string }

const STATUS_TABS = ['open', 'triaged', 'closed', 'all']

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

  const list = rows ?? []
  return (
    <>
      <PageHead
        title="Feedback"
        sub="Everything users sent through the in-app widget and surveys. Triage sets ownership; closing hides it from the default view."
        right={
          <nav className="ad-tabs" aria-label="Filter by status">
            {STATUS_TABS.map((s) => (
              <Link
                key={s}
                className="ad-tab"
                aria-current={s === status ? 'page' : undefined}
                href={`/admin/feedback?status=${s}${type ? `&type=${type}` : ''}`}
              >
                {s}
              </Link>
            ))}
          </nav>
        }
      />

      <div style={{ display: 'grid', gap: 14 }}>
        {catCounts.size > 0 && (
          <div className="ad-note">
            <span className="ad-kv">Themes</span>
            {FEEDBACK_CATEGORIES.filter(([v]) => catCounts.has(v)).map(([v, l]) => (
              <span key={v} className="v-badge">{l}: {catCounts.get(v)}</span>
            ))}
          </div>
        )}

        <Panel title={`${list.length} item${list.length === 1 ? '' : 's'}`} flush>
          {list.length === 0 ? (
            <Empty>No {status === 'all' ? '' : status} feedback.</Empty>
          ) : list.map((r) => {
            const profileRaw = r.profiles
            const profileObj = Array.isArray(profileRaw) ? profileRaw[0] : profileRaw
            const username = (profileObj as { username: string } | null)?.username
            return (
              <div key={r.id} className="ad-row ad-row-stack">
                <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="eyebrow">{FEEDBACK_TYPE_LABELS[r.type as FeedbackType] ?? r.type}</span>
                  {username && <Link className="ad-kv" href={`/${username}`}>@{username}</Link>}
                  {r.type === 'survey' && (r.meta as { survey?: string })?.survey && (
                    <span className="v-badge">{(r.meta as { survey?: string }).survey}</span>
                  )}
                  <When iso={r.created_at} />
                  <span className="sp">
                    <FeedbackCategory id={r.id} category={r.category} />
                    <FeedbackStatus id={r.id} status={r.status} />
                  </span>
                </div>
                <p style={{ whiteSpace: 'pre-wrap', fontSize: 14, margin: 0 }}>{r.message}</p>
                {r.page_url && <code className="ad-kv" style={{ fontSize: 11.5 }}>{r.page_url}</code>}
              </div>
            )
          })}
        </Panel>
      </div>
    </>
  )
}
