import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { parseAdminEmails } from '@/lib/admin'
import { userTierSummary } from '@/lib/admin-users'
import { PageHead, Section, Stat, Stats } from '../../_components/ui'
import { CompTierControl } from '../_components/CompTierControl'

export const dynamic = 'force-dynamic'

export default async function AdminUserDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const svc = createServiceClient()

  const [{ data: prof, error: profErr }, { data: authRes }] = await Promise.all([
    svc.from('profiles').select('username, display_name, comp_tier, created_at').eq('id', id).maybeSingle(),
    svc.auth.admin.getUserById(id),
  ])
  // Surface a real read failure as a 500 rather than masking a transient DB
  // error as "user not found". notFound() is only for a genuinely missing row.
  if (profErr) throw profErr
  if (!prof) notFound()

  const [{ count: trades }, { count: referrals }, { data: subs }] = await Promise.all([
    svc.from('trades').select('id', { count: 'exact', head: true }).eq('user_id', id),
    svc.from('referrals').select('referrer_id', { count: 'exact', head: true }).eq('referrer_id', id),
    svc.from('subscriptions').select('tier, status').eq('user_id', id),
  ])

  const email = authRes.user?.email ?? null
  // Highest active/trialing sub, mirroring admin_search_users ordering.
  const active = (subs ?? []).filter((s) => s.status === 'active' || s.status === 'trialing')
  const best = active.sort((a, b) => (b.tier === 'pro' ? 1 : 0) - (a.tier === 'pro' ? 1 : 0))[0] ?? null

  const { tier, source } = userTierSummary({
    email,
    compTier: prof.comp_tier,
    subTier: best?.tier ?? null,
    subStatus: best?.status ?? null,
    adminEmails: parseAdminEmails(process.env.ADMIN_EMAILS),
  })

  const comp = prof.comp_tier === 'trader' || prof.comp_tier === 'pro' ? prof.comp_tier : null

  return (
    <>
      <PageHead
        title={prof.username}
        sub={email ?? undefined}
        right={<Link className="ad-kv" href="/admin/users">← Directory</Link>}
      />

      <Stats>
        <Stat label="Effective tier" value={tier} sub={`via ${source}`} tone="accent" />
        <Stat label="Trades logged" value={trades ?? 0} />
        <Stat label="Referrals" value={referrals ?? 0} />
        <Stat label="Subscription" value={best ? best.status : 'none'} />
      </Stats>

      <Section title="Comp tier" sub="Grants Trader/Pro features without payment. Takes effect on the user's next page load. Does not grant admin access.">
        <CompTierControl userId={id} current={comp} />
      </Section>

      <Section title="Profile">
        <div className="ad-kv" style={{ fontSize: 13, lineHeight: 1.9 }}>
          <div>Display name: {prof.display_name ?? '—'}</div>
          <div>Joined: {new Date(prof.created_at).toLocaleString()}</div>
          <div>User ID: {id}</div>
        </div>
      </Section>
    </>
  )
}
