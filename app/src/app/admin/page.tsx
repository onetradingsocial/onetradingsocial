import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/service'
import { AlertsPanel, type AlertRow } from './_components/AlertsPanel'
import { PageHead, Panel, Stat, Stats, When } from './_components/ui'

export const dynamic = 'force-dynamic'

async function count(table: string, filter?: (q: any) => any): Promise<number> {
  const svc = createServiceClient()
  let q = svc.from(table).select('id', { count: 'exact', head: true })
  if (filter) q = filter(q)
  const { count } = await q
  return count ?? 0
}

const DAY = 864e5

export default async function AdminHome() {
  const svc = createServiceClient()
  const since7d = new Date(Date.now() - 7 * DAY).toISOString()

  const [openFeedback, users, new7d, trades, courses, openReports, { data: alerts }, { data: recent }] =
    await Promise.all([
      count('feedback', (q) => q.eq('status', 'open')),
      count('profiles'),
      count('profiles', (q) => q.gte('created_at', since7d).eq('is_internal', false)),
      count('trades'),
      count('courses'),
      count('trade_reports', (q) => q.eq('status', 'open')),
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
