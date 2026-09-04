import 'server-only'
import { cache } from 'react'
import { notFound } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { parseAdminEmails, emailIsAdmin } from '@/lib/admin'

export function isAdmin(user: { email?: string | null } | null): boolean {
  return emailIsAdmin(user?.email ?? null, parseAdminEmails(process.env.ADMIN_EMAILS))
}

/**
 * Memoised for the life of one request. Audit item 18, F2 made every admin page
 * repeat `requireAdmin()` on top of the layout's call, which is the correct
 * shape — a layout does not re-execute on every navigation, so it cannot be the
 * authorisation check — but naively it means two `auth.getUser()` round-trips
 * to GoTrue per page render.
 *
 * `cache()` collapses them to one **within a request** and never across
 * requests, so the gate is still evaluated freshly on every navigation and a
 * session that stops being valid stops passing immediately. The check is not
 * weakened; the duplicate network call is.
 */
export const getAdminUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user && isAdmin(user) ? user : null
})

/**
 * Gate for admin PAGES and layouts. 404s non-admins, which hides the route.
 *
 * Not for server actions. `notFound()` raised inside a Server Action does not
 * fail the action, it fails the *page*: Next renders the not-found boundary in
 * place of whatever the admin was looking at, so the admin shell survives and
 * the screen underneath it vanishes. A momentarily unauthenticated admin
 * therefore lost their work rather than being told what happened. Actions use
 * `getAdminUser()` above and return `{ error: NOT_ADMIN }` — same check, same
 * freshness, a failure the caller can render.
 */
export async function requireAdmin(): Promise<User> {
  const user = await getAdminUser()
  if (!user) notFound()
  return user
}

/**
 * What an admin server action returns when the caller is not an admin.
 *
 * Deliberately says nothing about *why*. A non-admin cannot reach an action id
 * without first loading a page that 404s them, so this wording is only ever
 * read by a real admin whose session lapsed mid-session.
 */
export const NOT_ADMIN = 'Not authorised.'
