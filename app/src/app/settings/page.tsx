import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getTier, getSubscription } from '@/lib/server/entitlements'
import { saveAccount } from '@/app/actions/account'
import { Icon } from '@/app/[username]/_components/Icon'
import { SettingsNav } from './SettingsNav'
import { ProfileSettingsForm } from './ProfileSettingsForm'
import './settings.css'

const PLAN_LABEL = { free: 'Free', trader: 'Trader', pro: 'Pro Trader' } as const

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: profile }, tier, sub] = await Promise.all([
    supabase
      .from('profiles')
      .select('username, display_name, bio, goal, avatar_url, experience_level, main_markets, trading_styles, is_public, account_balance, account_currency')
      .eq('id', user.id)
      .single(),
    getTier(supabase, user.id),
    getSubscription(supabase, user.id),
  ])

  const canGoPrivate = tier !== 'free'
  const renews = sub?.currentPeriodEnd
    ? new Date(sub.currentPeriodEnd).toLocaleDateString()
    : null

  return (
    <div className="h-app">
      <div className="h-main">
        <div className="settings-head">
          <p className="eyebrow">Account</p>
          <h1 className="ts-h1 mt-3">Settings</h1>
          <p className="ts-sub">@{profile?.username}</p>
        </div>

        <div className="settings-grid">
          <SettingsNav />

          <div className="settings-body">
            <ProfileSettingsForm
              avatarUrl={profile?.avatar_url ?? null}
              username={profile?.username ?? ''}
              displayName={profile?.display_name ?? ''}
              bio={profile?.bio ?? ''}
              goal={profile?.goal ?? ''}
              experience={profile?.experience_level ?? 'beginner'}
              markets={profile?.main_markets ?? []}
              styles={profile?.trading_styles ?? []}
              isPublic={profile?.is_public ?? true}
              canGoPrivate={canGoPrivate}
            />

            <section id="trading" className="ts-card settings-section">
              <h2 className="ts-h2"><Icon name="chart" size={18} /> Trading account</h2>
              <p className="ts-sub mb-4">Used to size trades by risk % and show P/L in money.</p>
              <form action={saveAccount} className="grid gap-3.5" style={{ maxWidth: 320 }}>
                <label className="ts-field">
                  <span className="ts-label">Account balance</span>
                  <input name="account_balance" type="number" step="0.01" min="0"
                    defaultValue={profile?.account_balance ?? 0} className="ts-input" />
                </label>
                <label className="ts-field">
                  <span className="ts-label">Currency</span>
                  <input name="account_currency" maxLength={3}
                    defaultValue={profile?.account_currency ?? 'USD'} className="ts-input" />
                </label>
                <button className="btn btn-primary">Save account</button>
              </form>
            </section>

            <section id="billing" className="ts-card settings-section">
              <h2 className="ts-h2"><Icon name="scale" size={18} /> Billing &amp; plan</h2>
              <p className="ts-sub mb-4">
                You&apos;re on the <b>{PLAN_LABEL[tier]}</b> plan
                {sub?.status && sub.status !== 'active' ? ` · ${sub.status}` : ''}.
                {sub?.cancelAtPeriodEnd && renews
                  ? ` Cancels on ${renews} — access continues until then.`
                  : renews ? ` Renews ${renews}.` : ''}
              </p>
              <a className="btn btn-ghost" href="/settings/billing">Manage plan</a>
            </section>

            <section id="account" className="ts-card settings-section">
              <h2 className="ts-h2"><Icon name="sliders" size={18} /> Account</h2>
              <p className="ts-sub mb-4">Your sign-in email and session.</p>
              <div className="ts-field mb-4" style={{ maxWidth: 360 }}>
                <span className="ts-label">Email</span>
                <div className="settings-readonly">{user.email}</div>
              </div>
              <form action="/auth/signout" method="post">
                <button className="btn btn-ghost">Log out</button>
              </form>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
