import { createBrowserClient } from '@supabase/ssr'
import { AUTH_COOKIE_OPTIONS } from './cookie-options'

/**
 * Browser Supabase client. Shares AUTH_COOKIE_OPTIONS with the server client
 * and the middleware: all three write the same cookie names, so if they
 * disagreed on the attributes the last writer would silently change them.
 * See `cookie-options.ts` for why `httpOnly` is not among them.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookieOptions: AUTH_COOKIE_OPTIONS },
  )
}
