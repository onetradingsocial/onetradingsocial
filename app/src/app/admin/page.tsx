import Link from 'next/link'
import { requireAdmin } from '@/lib/server/admin'
import { createServiceClient } from '@/lib/supabase/service'
import { AlertsPanel, type AlertRow } from './_components/AlertsPanel'
import { PageHead, Panel, Stat, Stats, When } from './_components/ui'

export const dynamic = 'force-dynamic'

// Filters are described rather than applied by a callback. The callback version
// took the query builder as `any`, because supabase-js's builder generics narrow
// on `.select()` and cannot be named in a signature without going stale on the
// next version bump. A tuple says the same thing with no escape hatch.
type CountFilter = [column: string, op: 'eq' | 'gte', value: string | number | boolean]

async function count(table: string, filters: CountFilter[] = []): Promise<number> {
  const svc = createServiceClient()
  let q = svc.from(table).select('id', { count: 'exact', head: true })
  for (const [column, op, value] of filters) q = op === 'eq' ? q.eq(column, value) : q.gte(column, value)
  const { count } = await q
  return count ?? 0
}

const DAY = 864e5

export default async function AdminHome() {
  // Audit item 18, F2. The layout gate above this page is NOT the authorisation
  // check: a layout does not re-execute on every navigation within its segment,
  // so a crafted RSC request for a nested page can reach the page without it.
  // Every page below therefore repeats the check itself, which makes the
  // service-role query and its authorisation inseparable. The layout keeps its
  // own call — it renders the nav and must not leak that either.
  await requireAdmin()
  const svc = createServiceClient()
  const since7d = new Date(Date.now() - 7 * DAY).toISOString()

  const [openFeedback, users, new7d, trades, courses, openReports, { data: alerts }, { data: recent }] =
    await Promise.all([
      count('feedback', [['status', 'eq', 'open']]),
      count('profiles'),
      count('profiles', [['created_at', 'gte', since7d], ['is_internal', 'eq', false]]),
      count('trades'),
      count('courses'),
      count('trade_reports', [['status', 'eq', 'open']]),
      svc.from('system_alerts').select('id, kind, message, acked, created_at')
        .eq('acked', false).order('created_at', { ascending: false }).limit(20),
      svc.from('admin_audit').select('id, actor_email, action, created_at')
        .order('created_at', { ascending: false }).limit(6),
    ])

  return (
    <>
      <PageHead
        title="Dashboard"
        sub="Live state of the platform. Anything needing a decision is flagged in the rail on the left."
      />

      <div style={{ display: 'grid', gap: 22 }}>
        <AlertsPanel alerts={(alerts ?? []) as AlertRow[]} />

        <Stats>
          <Stat label="Users" value={users} sub={`${new7d} new this week`} tone="accent" />
          <Stat label="Trades logged" value={trades} />
          <Stat label="Courses" value={courses} />
          <Stat
            label="Open feedback"
            value={openFeedback}
            tone={openFeedback > 0 ? 'warn' : undefined}
          />
          <Stat
            label="Open reports"
            value={openReports}
            tone={openReports > 0 ? 'warn' : undefined}
          />
        </Stats>

        <Panel title="Recent admin activity" right={<Link className="ad-kv" href="/admin/audit">View all →</Link>} flush>
          {(recent ?? []).length === 0 ? (
            <div className="ad-empty ad-empty--neutral"><span className="mark" aria-hidden>—</span><span>No admin actions recorded yet.</span></div>
          ) : (recent ?? []).map((r) => (
            <div key={r.id} className="ad-row">
              <code className="ad-kv">{r.action}</code>
              <span className="faint" style={{ fontSize: 12.5 }}>{r.actor_email ?? 'unknown'}</span>
              <span className="sp"><When iso={r.created_at} short /></span>
            </div>
          ))}
        </Panel>
      </div>
    </>
  )
}
