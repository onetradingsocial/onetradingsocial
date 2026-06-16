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
    <main className="mx-auto max-w-lg p-8">
      <h1 className="text-2xl font-bold">Settings</h1>
      <p className="mt-1 text-gray-600">@{profile?.username}</p>
      <section className="mt-6">
        <h2 className="text-sm font-medium">Avatar</h2>
        <div className="mt-2"><AvatarUploader current={profile?.avatar_url ?? null} /></div>
      </section>
      <form action="/app/auth/signout" method="post" className="mt-8">
        <button className="rounded border border-gray-300 px-4 py-2 text-sm">Log out</button>
      </form>
    </main>
  )
}
