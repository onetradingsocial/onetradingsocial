import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AvatarUploader } from '@/app/_components/AvatarUploader'
import { saveAccount } from '@/app/actions/account'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase
    .from('profiles').select('avatar_url, username, account_balance, account_currency').eq('id', user.id).single()

  return (
    <main className="ts-page" style={{ maxWidth: 620 }}>
      <p className="eyebrow">Account</p>
      <h1 className="ts-h1 mt-3">Settings</h1>
      <p className="ts-sub">@{profile?.username}</p>

      <section className="ts-card mt-7">
        <h2 className="ts-h2">Profile photo</h2>
        <p className="ts-sub mb-5">PNG or JPEG. Shown on your public profile.</p>
        <AvatarUploader current={profile?.avatar_url ?? null} />
      </section>

      <section className="ts-card mt-5">
        <h2 className="ts-h2">Trading account</h2>
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

      <section className="ts-card mt-5">
        <h2 className="ts-h2">Billing & plan</h2>
        <p className="ts-sub mb-4">View your plan, upgrade, or manage your subscription.</p>
        <a className="btn btn-ghost" href="/settings/billing">Manage plan</a>
      </section>

      <section className="ts-card mt-5">
        <h2 className="ts-h2">Session</h2>
        <p className="ts-sub mb-4">Sign out of TradingSocial on this device.</p>
        <form action="/auth/signout" method="post">
          <button className="btn btn-ghost">Log out</button>
        </form>
      </section>
    </main>
  )
}
