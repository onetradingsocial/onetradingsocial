import 'server-only'
import { notFound } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { parseAdminEmails, emailIsAdmin } from '@/lib/admin'

export function isAdmin(user: { email?: string | null } | null): boolean {
  return emailIsAdmin(user?.email ?? null, parseAdminEmails(process.env.ADMIN_EMAILS))
}

export async function getAdminUser(): Promise<User | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user && isAdmin(user) ? user : null
}

/** Gate for admin pages + every admin server action. 404s non-admins (hides the route). */
export async function requireAdmin(): Promise<User> {
  const user = await getAdminUser()
  if (!user) notFound()
  return user
}
