// Referral programme overview (Backlog row 39). Shows the funnel per referrer
// so rewards can be applied manually while the programme is in beta.
import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/service'
import { rewardsFor } from '@/lib/referral'

export const dynamic = 'force-dynamic'

export default async function AdminReferralsPage() {
  const svc = createServiceClient()
  const [{ data: referrals }, { data: codes }, { data: clicks }] = await Promise.all([
    svc.from('referrals').select('referrer_id, status'),
    svc.from('referral_codes').select('user_id, code'),
    svc.from('referral_clicks').select('code'),
  ])

  const clicksByCode = new Map<string, number>()
  for (const c of clicks ?? []) clicksByCode.set(c.code, (clicksByCode.get(c.code) ?? 0) + 1)

  const byReferrer = new Map<string, { signups: number; activated: number; paid: number }>()
  for (const r of referrals ?? []) {
    const e = byReferrer.get(r.referrer_id) ?? { signups: 0, activated: 0, paid: 0 }
    e.signups++
    if (r.status === 'activated' || r.status === 'paid') e.activated++
    if (r.status === 'paid') e.paid++
    byReferrer.set(r.referrer_id, e)
  }

  const ids = [...new Set([...byReferrer.keys(), ...(codes ?? []).map((c) => c.user_id)])]
  const { data: profs } = ids.length
    ? await svc.from('profiles').select('id, username').in('id', ids)
    : { data: [] as { id: string; username: string }[] }
  const nameOf = new Map((profs ?? []).map((p) => [p.id, p.username]))
  const codeOf = new Map((codes ?? []).map((c) => [c.user_id, c.code]))

  const rows = ids
    .map((id) => {
      const s = byReferrer.get(id) ?? { signups: 0, activated: 0, paid: 0 }
      const code = codeOf.get(id) ?? ''
      return { id, username: nameOf.get(id) ?? id.slice(0, 8), code, clicks: clicksByCode.get(code) ?? 0, ...s }
    })
    .filter((r) => r.clicks > 0 || r.signups > 0)
    .sort((a, b) => b.activated - a.activated || b.signups - a.signups)

  const totals = rows.reduce((t, r) => ({
    clicks: t.clicks + r.clicks, signups: t.signups + r.signups,
    activated: t.activated + r.activated, paid: t.paid + r.paid,
  }), { clicks: 0, signups: 0, activated: 0, paid: 0 })

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div>
        <h2 className="ts-h2">Referral programme</h2>
        <p className="ts-sub">Rewards unlock on activated referrals. Apply earned rewards manually during beta.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 14 }}>
        {([['Clicks', totals.clicks], ['Signups', totals.signups], ['Activated', totals.activated], ['Paid', totals.paid]] as const).map(([k, v]) => (
          <div key={k} className="ts-card" style={{ display: 'grid', gap: 4 }}>
            <span className="faint" style={{ fontSize: 13 }}>{k}</span>
            <strong style={{ fontSize: 26 }}>{v}</strong>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="faint">No referral activity yet.</p>
      ) : (
        <div className="ts-card" style={{ overflowX: 'auto' }}>
          <table className="ts-table">
            <thead><tr><th>Referrer</th><th>Code</th><th className="num">Clicks</th><th className="num">Signups</th><th className="num">Activated</th><th className="num">Paid</th><th>Rewards earned</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const earned = rewardsFor(r.activated).filter((x) => x.earned)
                return (
                  <tr key={r.id}>
                    <td><Link href={`/${r.username}`}>@{r.username}</Link></td>
                    <td className="mono" style={{ fontSize: 12 }}>{r.code || '—'}</td>
                    <td className="num">{r.clicks}</td>
                    <td className="num">{r.signups}</td>
                    <td className="num">{r.activated}</td>
                    <td className="num">{r.paid}</td>
                    <td>{earned.length === 0 ? <span className="faint">—</span> : earned.map((e) => <span key={e.id} className="v-badge" style={{ marginRight: 4 }}>{e.label}</span>)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
