import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? origin
  const code = searchParams.get('code')

  if (!code) {
    return NextResponse.redirect(`${base}/app/login?error=oauth`)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.redirect(`${base}/app/login?error=oauth`)
  }
  // New Google users have onboarding_completed=false; middleware sends them to onboarding.
  return NextResponse.redirect(`${base}/app`)
}
