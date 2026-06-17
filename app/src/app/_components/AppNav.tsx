import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Brand } from './Brand'

export async function AppNav() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let username: string | null = null
  if (user) {
    const { data } = await supabase
      .from('profiles').select('username').eq('id', user.id).single()
    username = data?.username ?? null
  }

  return (
    <nav className="ts-nav">
      <div className="ts-nav-inner">
        <Link href="/" aria-label="TradingSocial home"><Brand /></Link>
        <div className="ts-nav-links">
          {user ? (
            <>
              <Link className="ts-nav-link" href="/">Home</Link>
              <Link className="ts-nav-link" href="/journal">Journal</Link>
              {username && <Link className="ts-nav-link" href={`/${username}`}>Profile</Link>}
              <Link className="ts-nav-link" href="/settings">Settings</Link>
              <form action="/app/auth/signout" method="post">
                <button className="btn btn-ghost btn-sm" type="submit">Log out</button>
              </form>
            </>
          ) : (
            <>
              <Link className="ts-nav-link" href="/login">Log in</Link>
              <Link className="btn btn-primary btn-sm" href="/signup">Join the Beta</Link>
            </>
          )}
        </div>
      </div>
    </nav>
  )
}
