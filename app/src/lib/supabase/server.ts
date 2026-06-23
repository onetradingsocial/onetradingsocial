import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

type SessionUser = { id: string; email: string | null }

/**
 * Identify the signed-in user for READ paths (pages/layout) without a network
 * round-trip. `getClaims()` verifies the session JWT locally against the
 * project's asymmetric signing keys (cached JWKS), unlike `getUser()` which
 * calls the Supabase Auth server on every invocation.
 *
 * Use this in server components only. Server actions, route handlers, and any
 * mutation must keep `getUser()` — those need an authoritative server check.
 */
export async function getSessionUser(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<SessionUser | null> {
  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims
  if (!claims?.sub) return null
  return { id: claims.sub, email: (claims.email as string | undefined) ?? null }
}

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Called from a Server Component; session refresh handled by middleware.
          }
        },
      },
    },
  )
}
