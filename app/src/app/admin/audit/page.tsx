// Admin action audit log (row 52). Every privileged mutation is recorded here,
// and since audit item 18 F4 so are the reads that put one person's personal
// data in front of an admin.
import { requireAdmin } from '@/lib/server/admin'
import { createServiceClient } from '@/lib/supabase/service'
import { deletedActorLabel } from '@/lib/admin-mask'
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
  'user.comp_tier.set': 'Comp tier granted',
  'user.comp_tier.clear': 'Comp tier removed',
  // Reads (F4). Deliberately labelled as "viewed"/"revealed" so a reader can
  // tell at a glance which rows changed something and which only looked.
  'user.view': 'User record viewed',
  'users.search': 'Directory searched',
  'user.email.reveal': 'Email revealed',
  'broker.login.reveal': 'Broker login revealed',
  // Written by the account-deletion flow, not by an admin.
  'account.deleted': 'Account deleted (by the user)',
  'account.deletion_failed': 'Account deletion failed',
}

/**
 * The acting admin, as a label. Audit item 18, F7: when an admin deletes their
 * own account `actor_email` is nulled and `actor_email_hash` keeps a stable
 * pseudonym, so the column can be null while the row is still attributable.
 */
function actorLabel(r: { actor_email: string | null; actor_email_hash?: string | null }): string {
  if (r.actor_email) return r.actor_email
  if (r.actor_email_hash) return deletedActorLabel(r.actor_email_hash)
  return 'system'
}

type AuditRow = {
  id: number
  actor_email: string | null
  actor_email_hash?: string | null
  action: string
  target_type: string | null
  target_id: string | null
  detail: Record<string, unknown> | null
  created_at: string
}

export default async function AdminAuditPage() {
  // Audit item 18, F2 — see the note in admin/page.tsx.
  await requireAdmin()
  const svc = createServiceClient()
  // actor_email_hash arrives with migration 0052; select it separately so this
  // page still renders against a database where 0052 has not been applied.
  const base = 'id, actor_email, action, target_type, target_id, detail, created_at'
  const read = async (cols: string) =>
    svc.from('admin_audit').select(cols).order('created_at', { ascending: false }).limit(200)

  let { data: rows } = await read(`${base}, actor_email_hash`)
  if (!rows) ({ data: rows } = await read(base))

  const list = (rows ?? []) as unknown as AuditRow[]
  return (
    <>
      <PageHead
        title="Audit log"
        sub="Every privileged action — flag changes, moderation, content publishing — and every admin read of one person's record. Append-only: the database rejects UPDATE and DELETE on this table outright, including from the service role."
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
                  <td style={{ fontSize: 13 }}>{actorLabel(r)}</td>
                  <td><span className="v-badge">{LABEL[r.action] ?? r.action}</span></td>
                  <td className="adm-kv" style={{ fontSize: 11.5 }}>
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
