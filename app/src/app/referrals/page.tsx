import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient, getSessionUser } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { ensureReferralCode, getReferralStats } from '@/lib/server/referral'
import { rewardsFor, nextReward, conversionRates } from '@/lib/referral'
import { ReferralLink } from './ReferralLink'

export const metadata: Metadata = { title: 'Refer a trader — TradingSocial' }
export const dynamic = 'force-dynamic'

function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="ts-card" style={{ display: 'grid', gap: 4 }}>
      <span className="faint" style={{ fontSize: 13 }}>{label}</span>
      <strong style={{ fontSize: 28 }}>{value}</strong>
      {sub && <span className="faint" style={{ fontSize: 11.5 }}>{sub}</span>}
    </div>
  )
}

export default async function ReferralsPage() {
  const supabase = await createClient()
  const user = await getSessionUser(supabase)
  if (!user) redirect('/login')

  const svc = createServiceClient()
  const code = await ensureReferralCode(svc, user.id)
  if (!code) redirect('/')

  const stats = await getReferralStats(svc, user.id, code)
  const rewards = rewardsFor(stats.activated)
  const next = nextReward(stats.activated)
  const rates = conversionRates(stats)

  return (
    <main className="ts-page" style={{ maxWidth: 820 }}>
      <header className="lb-head"><div className="tx">
        <h1 className="ts-h1">Refer a trader</h1>
        <p>Share your link. You earn rewards when someone you refer actually starts journaling — not just when they sign up.</p>
      </div></header>

      <div className="ts-card mt-4">
        <h2 className="ts-h2">Your link</h2>
        <div className="mt-3"><ReferralLink code={code} /></div>
      </div>

      <div className="mt-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 14 }}>
        <Stat label="Clicks" value={stats.clicks} />
        <Stat label="Signups" value={stats.signups} sub={`${rates.clickToSignup}% of clicks`} />
        <Stat label="Activated" value={stats.activated} sub={`${rates.signupToActivated}% of signups`} />
        <Stat label="Paid" value={stats.paid} />
      </div>

      <div className="ts-card mt-4">
        <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <h2 className="ts-h2">Rewards</h2>
          {next && (
            <span className="faint" style={{ fontSize: 12.5 }}>
              {next.remaining} more activated referral{next.remaining === 1 ? '' : 's'} to unlock {next.reward.label}
            </span>
          )}
        </div>
        <div className="mt-3" style={{ display: 'grid', gap: 10 }}>
          {rewards.map((r) => (
            <div key={r.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
              padding: '12px 14px', borderRadius: 12,
              border: `1px solid ${r.earned ? 'rgba(18,165,107,0.35)' : 'var(--border)'}`,
              background: r.earned ? 'var(--up-soft)' : undefined,
            }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{r.earned ? '✓ ' : ''}{r.label}</div>
                <div className="faint" style={{ fontSize: 12.5 }}>{r.detail}</div>
              </div>
              <span className="v-badge">{r.needs} activated</span>
            </div>
          ))}
        </div>
        <p className="faint mt-3" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
          Rewards are non-cash and unlock on <b>activated</b> referrals — someone who signs up and logs a trade.
          Self-referrals don&apos;t count, and each trader can only ever be referred once. Earned rewards are applied manually
          by the team while the programme is in beta.
        </p>
      </div>
    </main>
  )
}
