// Admin action audit log (row 52). Every privileged mutation is recorded here.
import { createServiceClient } from '@/lib/supabase/service'

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

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div>
        <h2 className="ts-h2">Admin audit log</h2>
        <p className="ts-sub">
          Every privileged action — flag changes, moderation, content publishing. Append-only;
          nothing here can be edited or deleted through the app.
        </p>
      </div>

      {(rows ?? []).length === 0 ? (
        <p className="faint">No admin actions recorded yet.</p>
      ) : (
        <div className="ts-card" style={{ overflowX: 'auto' }}>
          <table className="ts-table">
            <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
            <tbody>
              {(rows ?? []).map((r) => (
                <tr key={r.id}>
                  <td className="faint" style={{ whiteSpace: 'nowrap', fontSize: 12.5 }}>
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td style={{ fontSize: 13 }}>{r.actor_email ?? '—'}</td>
                  <td><span className="v-badge">{LABEL[r.action] ?? r.action}</span></td>
                  <td className="mono" style={{ fontSize: 11.5 }}>
                    {r.target_type ? `${r.target_type}:${String(r.target_id).slice(0, 12)}` : '—'}
                  </td>
                  <td className="faint" style={{ fontSize: 11.5, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {Object.keys(r.detail ?? {}).length ? JSON.stringify(r.detail) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
