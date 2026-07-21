// Verification review dashboard (Sprint 2, row 6): pending/failed broker
// connections, failed imports, suspicious accounts and recent trade edits.
import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/service'
import { getSuspiciousAccounts } from '@/lib/server/suspicion'
import { ReportStatus } from '../_components/ReportStatus'
import { Empty, PageHead, Panel, Section, Stat, Stats, When } from '../_components/ui'

export const dynamic = 'force-dynamic'

const KIND_LABEL: Record<string, string> = {
  duplicates: 'Duplicate trades',
  impossible_timestamps: 'Impossible timestamps',
  no_losses: 'No losing trades',
  profit_spike: 'Profit spike',
  locked_field_edit: 'Locked-field edit',
}

const REASON_LABEL: Record<string, string> = {
  suspicious_performance: 'Suspicious performance', misleading_claims: 'Misleading claims',
  impersonation: 'Impersonation', manipulated_screenshots: 'Manipulated screenshots',
  spam: 'Spam', advice_violation: 'Advice violation',
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

  const pendingOrBroken = (brokers ?? []).filter((b) => b.status !== 'active')
  const openReports = reports ?? []
  const imports = failedImports ?? []
  const tradeEdits = edits ?? []

  return (
    <>
      <PageHead
        title="Verification"
        sub="Trust queue. Heuristics surface accounts worth a look — nothing here is auto-punished, every action is yours."
      />

      <div className="ad-stack">
        <Stats>
          <Stat label="Open reports" value={openReports.length} tone={openReports.length ? 'warn' : undefined} />
          <Stat label="Flagged accounts" value={suspicious.length} tone={suspicious.length ? 'warn' : undefined} />
          <Stat label="Broker issues" value={pendingOrBroken.length} tone={pendingOrBroken.length ? 'warn' : undefined} />
          <Stat label="Failed imports" value={imports.length} />
        </Stats>

        <Section title="User reports" sub="Filed by traders against profiles — review and action, or dismiss.">
          <Panel flush>
            {openReports.length === 0 ? <Empty ok>No open reports.</Empty> : openReports.map((r) => (
              <div key={r.id} className="ad-row ad-row-stack">
                <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="v-badge vb-failed">{REASON_LABEL[r.reason] ?? r.reason}</span>
                  <Link href={`/${uname.get(r.reported_user_id ?? '') ?? ''}`} style={{ fontWeight: 700 }}>
                    @{uname.get(r.reported_user_id ?? '') ?? 'unknown'}
                  </Link>
                  <span className="faint" style={{ fontSize: 12 }}>
                    reported by @{uname.get(r.reporter_id) ?? 'unknown'}
                  </span>
                  <When iso={r.created_at} />
                  <span className="sp"><ReportStatus id={r.id} status={r.status} /></span>
                </div>
                {r.detail && <p style={{ fontSize: 13, margin: 0 }}>{r.detail}</p>}
              </div>
            ))}
          </Panel>
        </Section>

        <Section title="Suspicious accounts" sub="Heuristics over all non-internal accounts. A flag is a prompt to look, not a verdict.">
          <Panel flush>
            {suspicious.length === 0 ? <Empty ok>Nothing flagged.</Empty> : suspicious.map((f, i) => (
              <div key={i} className="ad-row">
                <Link href={`/${f.username}`} style={{ fontWeight: 700 }}>@{f.username}</Link>
                <span className="v-badge vb-failed">{KIND_LABEL[f.kind] ?? f.kind}</span>
                <span className="faint" style={{ fontSize: 13 }}>{f.detail}</span>
              </div>
            ))}
          </Panel>
        </Section>

        <Section title="Broker connections needing attention" sub="Pending = verification in progress; error = verification failed.">
          <Panel flush scroll>
            {pendingOrBroken.length === 0 ? <Empty ok>All broker connections healthy.</Empty> : (
              <table className="ts-table">
                <thead><tr><th>User</th><th>Login</th><th>Server</th><th>Status</th><th>Last sync</th><th>Error</th></tr></thead>
                <tbody>
                  {pendingOrBroken.map((b) => {
                    const p = Array.isArray(b.profiles) ? b.profiles[0] : b.profiles
                    return (
                      <tr key={b.user_id}>
                        <td>@{p?.username ?? b.user_id.slice(0, 8)}</td>
                        <td className="ad-kv">{b.login}</td>
                        <td className="ad-kv">{b.server}</td>
                        <td><span className={`v-badge ${b.status === 'pending' ? 'vb-pending' : 'vb-failed'}`}>{b.status}</span></td>
                        <td>{b.last_sync_at ? <When iso={b.last_sync_at} short /> : <span className="faint">—</span>}</td>
                        <td className="faint" style={{ fontSize: 12, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {b.sync_error ?? '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </Panel>
        </Section>

        <Section title="Failed imports" sub="Most recent 20. A cluster of the same reason usually means a parser bug, not user error.">
          <Panel flush>
            {imports.length === 0 ? <Empty ok>No failed imports.</Empty> : imports.map((f, i) => (
              <div key={i} className="ad-row">
                <span>@{uname.get(f.user_id ?? '') ?? 'unknown'}</span>
                <span className="faint">{String((f.props as { reason?: string })?.reason ?? 'unknown reason')}</span>
                <span className="sp"><When iso={f.created_at} short /></span>
              </div>
            ))}
          </Panel>
        </Section>

        <Section title="Recent trade edits" sub="Full immutable history lives in trade_audits; imported execution fields are DB-locked.">
          <Panel flush>
            {tradeEdits.length === 0 ? <Empty>No edits recorded yet.</Empty> : tradeEdits.map((e, i) => (
              <div key={i} className="ad-row">
                <span>@{uname.get(e.user_id) ?? e.user_id.slice(0, 8)}</span>
                <span className="faint">edited</span>
                <code className="ad-kv">{(e.changed_fields as string[]).join(', ')}</code>
                <span className="sp"><When iso={e.created_at} short /></span>
              </div>
            ))}
          </Panel>
        </Section>
      </div>
    </>
  )
}
