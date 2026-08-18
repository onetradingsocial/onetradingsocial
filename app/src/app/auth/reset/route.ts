import { type NextRequest } from 'next/server'
import { consumeGrant } from '@/lib/server/auth-grant'

/**
 * Password-recovery callback (item 9 F1). Consumes the recovery grant
 * server-side and hands the browser on to `/reset-password`.
 *
 * A route handler, not a page — see `lib/server/auth-grant.ts` for why that is
 * the property that keeps the token away from GA / Meta / Reddit.
 *
 * This path must be added to the Supabase Redirect URL allowlist:
 *   https://app.tradingsocial.io/auth/reset
 */
export async function GET(request: NextRequest) {
  return consumeGrant(request, {
    successPath: '/reset-password',
    expectTypes: ['recovery'],
    label: 'auth/reset',
  })
}
