// Admin action audit log (row 52). Every privileged mutation is recorded here.
import { createServiceClient } from '@/lib/supabase/service'
import { Empty, PageHead, Panel, When } from '../_components/ui'

export const dynamic = 'force-dynamic'

const LABEL: Record<string, string> = {
  'feedback.status': 'Feedback status',
  'feedback.category': 'Feedback category',
  'feature_request.status': 'Feature request status',
  'trade_report.status': 'Report status',
  'system_alert.ack': 'Alert acknowledged',
  'course.create': 'Course created',
  'course.update': 'Course updated',
  'course.publish': 'Course publish toggled',
  'lesson.create': 'Lesson created',
  'lesson.update': 'Lesson updated',
  'lesson.publish': 'Lesson publish toggled',
  'lesson.quiz.set': 'Quiz replaced',
  'feature_flag.set': 'Feature flag changed',
  'feature_flag.reset': 'Feature flag reset',
}

export default async function AdminAuditPage() {
  const svc = createServiceClient()
  const { data: rows } = await svc
    .from('admin_audit')
    .select('id, actor_email, action, target_type, target_id, detail, created_at')
    .order('created_at', { ascending: false })
    .limit(200)

  const list = rows ?? []
  return (
    <>
      <PageHead
        title="Audit log"
        sub="Every privileged action — flag changes, moderation, content publishing. Append-only; nothing here can be edited or deleted through the app."
        right={<span className="v-badge">Append-only</span>}
      />

      <Panel title={`Last ${list.length} action${list.length === 1 ? '' : 's'}`} flush scroll>
        {list.length === 0 ? (
          <Empty>No admin actions recorded yet.</Empty>
        ) : (
          <table className="ts-table">
            <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td><When iso={r.created_at} /></td>
                  <td style={{ fontSize: 13 }}>{r.actor_email ?? '—'}</td>
                  <td><span className="v-badge">{LABEL[r.action] ?? r.action}</span></td>
                  <td className="ad-kv" style={{ fontSize: 11.5 }}>
                    {r.target_type ? `${r.target_type}:${String(r.target_id).slice(0, 12)}` : '—'}
                  </td>
                  <td className="faint" style={{ fontSize: 11.5, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {Object.keys(r.detail ?? {}).length ? JSON.stringify(r.detail) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  )
}
