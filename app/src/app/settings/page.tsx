import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AvatarUploader } from '@/app/_components/AvatarUploader'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase
    .from('profiles').select('avatar_url, username').eq('id', user.id).single()

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
        <h2 className="ts-h2">Session</h2>
        <p className="ts-sub mb-4">Sign out of TradingSocial on this device.</p>
        <form action="/app/auth/signout" method="post">
          <button className="btn btn-ghost">Log out</button>
        </form>
      </section>
    </main>
  )
}
