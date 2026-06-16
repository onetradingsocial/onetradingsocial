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
    .eq('username', username)
    .maybeSingle()

  // RLS hides private profiles from non-owners -> no row -> 404 (no existence leak).
  if (!profile) notFound()

  const name = profile.display_name ?? profile.username
  const initial = name.charAt(0).toUpperCase()
  const styles: string[] = profile.trading_styles ?? []
  const markets: string[] = profile.main_markets ?? []

  return (
    <main className="ts-page" style={{ maxWidth: 720 }}>
      <div className="ts-card">
        <header className="flex items-center gap-5">
          {profile.avatar_url
            ? <img src={profile.avatar_url} alt="" className="ts-avatar" />
            : <div className="ts-avatar ts-avatar--ph">{initial}</div>}
          <div>
            <h1 className="ts-h1">{name}</h1>
            <p className="muted" style={{ fontWeight: 600 }}>@{profile.username}</p>
          </div>
        </header>

        {profile.bio && <p className="mt-5" style={{ color: 'var(--dim)', maxWidth: '60ch' }}>{profile.bio}</p>}

        {(markets.length > 0 || styles.length > 0) && (
          <div className="mt-5">
            {markets.map((m) => <span key={m} className="ts-tag">{m}</span>)}
            {styles.map((s) => <span key={s} className="ts-tag">{s}</span>)}
          </div>
        )}

        <dl className="ts-statgrid mt-6">
          <div className="ts-stat"><dt>Experience</dt><dd>{profile.experience_level ?? '—'}</dd></div>
          <div className="ts-stat"><dt>Level</dt><dd>Level {profile.level} · {profile.xp} XP</dd></div>
          <div className="ts-stat"><dt>Followers</dt><dd>0 · 0 following</dd></div>
          <div className="ts-stat"><dt>Member since</dt><dd>{new Date(profile.created_at).toLocaleDateString()}</dd></div>
        </dl>
      </div>

      <div className="ts-placeholder mt-5">
        No trades logged yet<span className="lab">Journal · Phase 2</span>
      </div>
    </main>
  )
}
