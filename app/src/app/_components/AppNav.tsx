import Link from 'next/link'
import { createClient, getSessionUser } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/server/admin'
import { Brand } from './Brand'
import { NewTradeButton } from './NewTradeButton'
import { NavLinks } from './NavLinks'

export async function AppNav() {
  const supabase = await createClient()
  const user = await getSessionUser(supabase)

  let profile: { username: string; avatar_url: string | null } | null = null
  if (user) {
    const { data } = await supabase.from('profiles').select('username, avatar_url').eq('id', user.id).single()
    profile = data
  }

  return (
    <nav className="ts-nav">
      <div className="ts-nav-inner">
        <Link href="/" aria-label="TradingSocial home" className="ts-nav-brand"><Brand /></Link>

        {user ? (
          <>
            <NavLinks />
            <label className="ts-nav-search">
              <span aria-hidden>⌕</span>
              <input placeholder="Search traders, setups, markets…" aria-label="Search" />
            </label>
            <div className="ts-nav-right">
              <button type="button" className="ts-nav-icon" title="Notifications — soon" aria-label="Notifications">🔔</button>
              <button type="button" className="ts-nav-icon" title="Messages — soon" aria-label="Messages">✉</button>
              <NewTradeButton className="btn btn-primary btn-sm" />
              {isAdmin(user) && (
                <Link href="/admin" className="ts-nav-icon" title="Admin" aria-label="Admin">🛡</Link>
              )}
              <Link href="/settings" className="ts-nav-icon" title="Settings" aria-label="Settings">⚙</Link>
              {profile?.username && (
                <Link href={`/${profile.username}`} className="ts-nav-avatar" aria-label="Your profile">
                  {profile.avatar_url
                    ? <img src={profile.avatar_url} alt="" />
                    : <span>{profile.username.charAt(0).toUpperCase()}</span>}
                </Link>
              )}
            </div>
          </>
        ) : (
          <div className="ts-nav-links">
            <Link className="ts-nav-link" href="/login">Log in</Link>
            <Link className="btn btn-primary btn-sm" href="/signup">Join the Beta</Link>
          </div>
        )}
      </div>
    </nav>
  )
}
