import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  await supabase.auth.signOut()
  // Same-origin route, so redirect relative to the host actually in use. Keying
  // off NEXT_PUBLIC_SITE_URL sent everyone to whatever port that env var was set
  // to (localhost:3000 in dev, wrong on every preview deployment) and dropped
  // them on a 404 outside the app.
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 })
}
