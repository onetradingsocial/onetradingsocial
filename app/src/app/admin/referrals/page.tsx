// Referral programme overview (Backlog row 39). Shows the funnel per referrer
// so rewards can be applied manually while the programme is in beta.
import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/service'
import { earnedMonths } from '@/lib/referral'
import { Empty, PageHead, Panel, Stat, Stats } from '../_components/ui'

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

  const rate = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}% of previous step` : undefined)

  return (
    <>
      <PageHead
        title="Referrals"
        sub="Each activated referral earns the referrer 1 month of free Pro (max 12), redeemed via a $0 Stripe checkout that converts to monthly billing."
      />

      <div className="ad-stack">
        <Stats>
          <Stat label="Clicks" value={totals.clicks} />
          <Stat label="Signups" value={totals.signups} sub={rate(totals.signups, totals.clicks)} />
          <Stat label="Activated" value={totals.activated} sub={rate(totals.activated, totals.signups)} tone="accent" />
          <Stat label="Paid" value={totals.paid} sub={rate(totals.paid, totals.activated)} />
        </Stats>

        <Panel title="By referrer" flush scroll>
          {rows.length === 0 ? <Empty>No referral activity yet.</Empty> : (
            <table className="ts-table">
              <thead>
                <tr>
                  <th>Referrer</th><th>Code</th>
                  <th className="num">Clicks</th><th className="num">Signups</th>
                  <th className="num">Activated</th><th className="num">Paid</th>
                  <th className="num">Pro months</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const months = earnedMonths(r.activated)
                  return (
                    <tr key={r.id}>
                      <td><Link href={`/${r.username}`}>@{r.username}</Link></td>
                      <td className="ad-kv">{r.code || '—'}</td>
                      <td className="num">{r.clicks}</td>
                      <td className="num">{r.signups}</td>
                      <td className="num">{r.activated}</td>
                      <td className="num">{r.paid}</td>
                      <td className="num">
                        {months === 0 ? <span className="faint">—</span> : (
                          <span className="v-badge vb-statement">{months} mo</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </>
  )
}
