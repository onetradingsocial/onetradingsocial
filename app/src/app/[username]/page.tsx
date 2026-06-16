import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { RESERVED_USERNAMES } from '@/lib/username'

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>
}) {
  const { username } = await params
  if ((RESERVED_USERNAMES as readonly string[]).includes(username.toLowerCase())) notFound()

  const supabase = await createClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('username, display_name, bio, avatar_url, experience_level, main_markets, trading_styles, xp, level, created_at')
    .ilike('username', username)
    .maybeSingle()

  // RLS hides private profiles from non-owners -> no row -> 404 (no existence leak).
  if (!profile) notFound()

  return (
    <main className="mx-auto max-w-2xl p-8">
      <header className="flex items-center gap-4">
        {profile.avatar_url && (
          <img src={profile.avatar_url} alt="" className="h-16 w-16 rounded-full object-cover" />
        )}
        <div>
          <h1 className="text-2xl font-bold">{profile.display_name ?? profile.username}</h1>
          <p className="text-gray-500">@{profile.username}</p>
        </div>
      </header>

      {profile.bio && <p className="mt-4 text-gray-700">{profile.bio}</p>}

      <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
        <div><dt className="text-gray-500">Experience</dt><dd className="capitalize">{profile.experience_level ?? '—'}</dd></div>
        <div><dt className="text-gray-500">Markets</dt><dd>{profile.main_markets?.join(', ') || '—'}</dd></div>
        <div><dt className="text-gray-500">Styles</dt><dd>{profile.trading_styles?.join(', ') || '—'}</dd></div>
        <div><dt className="text-gray-500">Member since</dt><dd>{new Date(profile.created_at).toLocaleDateString()}</dd></div>
      </dl>

      {/* Placeholders for later phases */}
      <section className="mt-6 rounded border border-gray-200 p-4 text-sm text-gray-500">
        <div>XP: {profile.xp} · Level {profile.level} <span className="text-gray-400">(coming soon)</span></div>
        <div className="mt-1">Followers 0 · Following 0 <span className="text-gray-400">(Phase 3)</span></div>
        <div className="mt-1">No trades logged yet <span className="text-gray-400">(Phase 2)</span></div>
      </section>
    </main>
  )
}
