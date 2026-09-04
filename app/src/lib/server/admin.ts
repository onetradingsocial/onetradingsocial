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

/** Gate for admin pages + every admin server action. 404s non-admins (hides the route). */
export async function requireAdmin(): Promise<User> {
  const user = await getAdminUser()
  if (!user) notFound()
  return user
}
