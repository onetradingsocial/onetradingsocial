import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = user
    ? await supabase.from('profiles').select('username, display_name').eq('id', user.id).single()
    : { data: null }

  const name = profile?.display_name ?? profile?.username ?? 'trader'

  return (
    <main className="ts-page">
      <p className="eyebrow">Your dashboard</p>
      <h1 className="ts-h1 mt-3" style={{ fontSize: 36 }}>
        Welcome back, <span className="grad-text">{name}</span>
      </h1>
      <p className="ts-sub" style={{ maxWidth: '52ch' }}>
        Your newsfeed lands here soon — followed traders, journal updates, leaderboard moves and XP.
        For now, set up your profile and explore.
      </p>

      <div className="mt-7 grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        {profile?.username && (
          <Link href={`/${profile.username}`} className="ts-card" style={{ padding: 22 }}>
            <h2 className="ts-h2">Your profile</h2>
            <p className="ts-sub">View your public trader resume.</p>
          </Link>
        )}
        <Link href="/settings" className="ts-card" style={{ padding: 22 }}>
          <h2 className="ts-h2">Settings</h2>
          <p className="ts-sub">Add a photo and manage your account.</p>
        </Link>
        <div className="ts-card" style={{ padding: 22, opacity: 0.7 }}>
          <h2 className="ts-h2">Journal <span className="faint" style={{ fontSize: 12 }}>soon</span></h2>
          <p className="ts-sub">Log trades, tag mistakes, track your edge.</p>
        </div>
        <div className="ts-card" style={{ padding: 22, opacity: 0.7 }}>
          <h2 className="ts-h2">Leaderboard <span className="faint" style={{ fontSize: 12 }}>soon</span></h2>
          <p className="ts-sub">Rank on consistency, XP and learning.</p>
        </div>
      </div>
    </main>
  )
}
