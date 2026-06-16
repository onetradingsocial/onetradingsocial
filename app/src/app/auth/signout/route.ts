import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  await supabase.auth.signOut()
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin
  return NextResponse.redirect(`${base}/app/login`, { status: 303 })
}
