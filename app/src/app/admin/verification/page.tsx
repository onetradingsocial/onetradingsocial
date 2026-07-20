// Verification review dashboard (Sprint 2, row 6): pending/failed broker
// connections, failed imports, suspicious accounts and recent trade edits.
import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/service'
import { getSuspiciousAccounts } from '@/lib/server/suspicion'
import { ReportStatus } from '../_components/ReportStatus'

export const dynamic = 'force-dynamic'

const KIND_LABEL: Record<string, string> = {
  duplicates: 'Duplicate trades',
  impossible_timestamps: 'Impossible timestamps',
  no_losses: 'No losing trades',
  profit_spike: 'Profit spike',
  locked_field_edit: 'Locked-field edit',
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'grid', gap: 10 }}>
      <div>
        <h2 className="ts-h2">{title}</h2>
        {sub && <p className="ts-sub">{sub}</p>}
      </div>
      {children}
    </section>
  )
}

export default async function VerificationReviewPage() {
  const svc = createServiceClient()
  const [suspicious, { data: brokers }, { data: failedImports }, { data: edits }, { data: reports }] = await Promise.all([
    getSuspiciousAccounts(svc),
    svc.from('broker_accounts')
      .select('user_id, login, server, status, last_sync_at, sync_error, created_at, profiles(username)')
      .order('created_at', { ascending: false }).limit(50),
    svc.from('analytics_events')
      .select('user_id, props, created_at')
      .eq('event', 'import_failed')
      .order('created_at', { ascending: false }).limit(20),
    svc.from('trade_audits')
      .select('user_id, trade_id, action, changed_fields, created_at')
      .eq('action', 'updated')
      .order('created_at', { ascending: false }).limit(25),
    svc.from('trade_reports')
      .select('id, reporter_id, reported_user_id, reason, detail, status, created_at')
      .eq('status', 'open')
      .order('created_at', { ascending: false }).limit(50),
  ])

  const userIds = [...new Set([
    ...(failedImports ?? []).map((f) => f.user_id),
    ...(edits ?? []).map((e) => e.user_id),
    ...(reports ?? []).map((r) => r.reported_user_id),
    ...(reports ?? []).map((r) => r.reporter_id),
  ])].filter(Boolean) as string[]
  const { data: profs } = userIds.length
    ? await svc.from('profiles').select('id, username').in('id', userIds)
    : { data: [] as { id: string; username: string }[] }
  const uname = new Map((profs ?? []).map((p) => [p.id, p.username]))

  const REASON_LABEL: Record<string, string> = {
    suspicious_performance: 'Suspicious performance', misleading_claims: 'Misleading claims',
    impersonation: 'Impersonation', manipulated_screenshots: 'Manipulated screenshots',
    spam: 'Spam', advice_violation: 'Advice violation',
  }

  const pendingOrBroken = (brokers ?? []).filter((b) => b.status !== 'active')

  return (
    <div style={{ display: 'grid', gap: 28 }}>
      <Section title="User reports" sub="Filed by traders against profiles — review and action or dismiss.">
        {(reports ?? []).length === 0 ? (
          <p className="faint">No open reports. ✓</p>
        ) : (
          <div className="ts-card" style={{ display: 'grid', gap: 8 }}>
            {(reports ?? []).map((r) => (
              <div key={r.id} style={{ display: 'grid', gap: 3, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span className="v-badge vb-failed">{REASON_LABEL[r.reason] ?? r.reason}</span>
                  <Link href={`/${uname.get(r.reported_user_id ?? '') ?? ''}`} style={{ fontWeight: 700 }}>@{uname.get(r.reported_user_id ?? '') ?? 'unknown'}</Link>
                  <span className="faint" style={{ fontSize: 12 }}>reported by @{uname.get(r.reporter_id) ?? 'unknown'} · {new Date(r.created_at).toLocaleString()}</span>
                  <span style={{ marginLeft: 'auto' }}><ReportStatus id={r.id} status={r.status} /></span>
                </div>
                {r.detail && <p style={{ fontSize: 13, margin: 0 }}>{r.detail}</p>}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Suspicious accounts" sub="Heuristics over all non-internal accounts — review before acting, nothing is auto-punished.">
        {suspicious.length === 0 ? (
          <p className="faint">Nothing flagged. ✓</p>
        ) : (
          <div className="ts-card" style={{ display: 'grid', gap: 8 }}>
            {suspicious.map((f, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <Link href={`/${f.username}`} style={{ fontWeight: 700 }}>@{f.username}</Link>
                <span className="v-badge vb-failed">{KIND_LABEL[f.kind]}</span>
                <span className="faint" style={{ fontSize: 13 }}>{f.detail}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Broker connections needing attention" sub="Pending = verification in progress; error = verification failed.">
        {pendingOrBroken.length === 0 ? (
          <p className="faint">All broker connections healthy. ✓</p>
        ) : (
          <div className="ts-card" style={{ overflowX: 'auto' }}>
            <table className="ts-table">
              <thead><tr><th>User</th><th>Login</th><th>Server</th><th>Status</th><th>Last sync</th><th>Error</th></tr></thead>
              <tbody>
                {pendingOrBroken.map((b) => {
                  const p = Array.isArray(b.profiles) ? b.profiles[0] : b.profiles
                  return (
                    <tr key={b.user_id}>
                      <td>@{p?.username ?? b.user_id.slice(0, 8)}</td>
                      <td className="mono">{b.login}</td>
                      <td className="mono">{b.server}</td>
                      <td><span className={`v-badge ${b.status === 'pending' ? 'vb-pending' : 'vb-failed'}`}>{b.status}</span></td>
                      <td className="faint">{b.last_sync_at ? new Date(b.last_sync_at).toLocaleString() : '—'}</td>
                      <td className="faint" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.sync_error ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Failed imports (recent)">
        {(failedImports ?? []).length === 0 ? (
          <p className="faint">No failed imports. ✓</p>
        ) : (
          <div className="ts-card" style={{ display: 'grid', gap: 6 }}>
            {(failedImports ?? []).map((f, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
                <span>@{uname.get(f.user_id ?? '') ?? 'unknown'} — {String((f.props as { reason?: string })?.reason ?? 'unknown reason')}</span>
                <span className="faint">{new Date(f.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Recent trade edits" sub="Full immutable history lives in trade_audits; imported execution fields are DB-locked.">
        {(edits ?? []).length === 0 ? (
          <p className="faint">No edits recorded yet.</p>
        ) : (
          <div className="ts-card" style={{ display: 'grid', gap: 6 }}>
            {(edits ?? []).map((e, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
                <span>@{uname.get(e.user_id) ?? e.user_id.slice(0, 8)} edited <code style={{ fontSize: 12 }}>{(e.changed_fields as string[]).join(', ')}</code></span>
                <span className="faint">{new Date(e.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}
