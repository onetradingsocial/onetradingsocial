import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  // Same-origin hops, so stay on the origin the callback arrived at rather than
  // bouncing to whatever NEXT_PUBLIC_SITE_URL happens to say (see signout).
  const { searchParams, origin: base } = new URL(request.url)
  const code = searchParams.get('code')

  if (!code) {
    return NextResponse.redirect(`${base}/login?error=oauth`)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.redirect(`${base}/login?error=oauth`)
  }
  // New Google users have onboarding_completed=false; middleware sends them to onboarding.
  return NextResponse.redirect(`${base}/`)
}
