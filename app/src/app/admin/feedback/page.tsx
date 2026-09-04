import Link from 'next/link'
import { requireAdmin } from '@/lib/server/admin'
import { createServiceClient } from '@/lib/supabase/service'
import { FEEDBACK_TYPE_LABELS, type FeedbackType } from '@/lib/feedback'
import { FeedbackStatus } from '../_components/FeedbackStatus'
import { FeedbackCategory, FEEDBACK_CATEGORIES } from '../_components/FeedbackCategory'
import { FeedbackReply } from '../_components/FeedbackReply'
import { Empty, PageHead, Panel, When } from '../_components/ui'

type Search = { status?: string; type?: string }

const STATUS_TABS = ['open', 'triaged', 'closed', 'all']

export default async function AdminFeedback({ searchParams }: { searchParams: Promise<Search> }) {
  // Audit item 18, F2. The layout gate above this page is NOT the authorisation
  // check: a layout does not re-execute on every navigation within its segment,
  // so a crafted RSC request for a nested page can reach the page without it.
  // Every page below therefore repeats the check itself, which makes the
  // service-role query and its authorisation inseparable. The layout keeps its
  // own call — it renders the nav and must not leak that either.
  await requireAdmin()
  const { status = 'open', type } = await searchParams
  const svc = createServiceClient()
  // The embed MUST name its foreign key. `feedback` has had two FKs to
  // `profiles` since 0066 added admin_reply_by, so a bare `profiles(username)`
  // is ambiguous and PostgREST refuses the whole query with PGRST201 — it
  // cannot know whether the row wants the submitter or the admin who replied.
  // This is the submitter, which is what the row renders next to the message.
  let q = svc.from('feedback')
    .select('id, type, message, page_url, status, category, meta, created_at, admin_reply, admin_reply_at, profiles!feedback_user_id_fkey(username)')
    .order('created_at', { ascending: false })
    .limit(200)
  if (status !== 'all') q = q.eq('status', status)
  if (type) q = q.eq('type', type)
  const { data: rows, error } = await q

  // Category frequency across everything (not just the filtered view).
  const { data: catRows } = await svc.from('feedback').select('category').not('category', 'is', null)
  const catCounts = new Map<string, number>()
  for (const r of catRows ?? []) catCounts.set(r.category as string, (catCounts.get(r.category as string) ?? 0) + 1)

  const list = rows ?? []
  return (
    <>
      <PageHead
        title="Feedback"
        sub="Everything users sent through the in-app widget and surveys. Triage sets ownership; closing hides it from the default view. A reply is shown to the submitter at /settings/feedback and sent as a notification."
        right={
          <nav className="adm-tabs" aria-label="Filter by status">
            {STATUS_TABS.map((s) => (
              <Link
                key={s}
                className="adm-tab"
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
          <div className="adm-note">
            <span className="adm-kv">Themes</span>
            {FEEDBACK_CATEGORIES.filter(([v]) => catCounts.has(v)).map(([v, l]) => (
              <span key={v} className="v-badge">{l}: {catCounts.get(v)}</span>
            ))}
          </div>
        )}

        <Panel title={`${list.length} item${list.length === 1 ? '' : 's'}`} flush>
          {/* A failed query and an empty queue are not the same thing, and until
              now they rendered identically: the error was discarded and the page
              said "No open feedback" while the rail's own count said otherwise.
              That is how a broken embed survived a deploy. Say which it is. */}
          {error ? (
            <Empty>Could not load feedback — {error.message}</Empty>
          ) : list.length === 0 ? (
            <Empty>No {status === 'all' ? '' : status} feedback.</Empty>
          ) : list.map((r) => {
            const profileRaw = r.profiles
            const profileObj = Array.isArray(profileRaw) ? profileRaw[0] : profileRaw
            const username = (profileObj as { username: string } | null)?.username
            return (
              <div key={r.id} className="adm-row adm-row-stack">
                <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="eyebrow">{FEEDBACK_TYPE_LABELS[r.type as FeedbackType] ?? r.type}</span>
                  {username && <Link className="adm-kv" href={`/${username}`}>@{username}</Link>}
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
                {r.page_url && <code className="adm-kv" style={{ fontSize: 11.5 }}>{r.page_url}</code>}
                <FeedbackReply id={r.id} reply={r.admin_reply} repliedAt={r.admin_reply_at} />
              </div>
            )
          })}
        </Panel>
      </div>
    </>
  )
}
