import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * Referral link entry point: /r/<code> (Backlog row 39).
 * Logs the click, drops the attribution cookie, then sends the visitor to
 * signup. Unknown codes still redirect — a broken link should never dead-end.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const clean = (code ?? '').trim().slice(0, 24)

  const url = req.nextUrl.clone()
  url.pathname = '/signup'
  url.search = ''
  const res = NextResponse.redirect(url)

  if (clean) {
    // 30-day attribution window; first code wins so a later link can't hijack
    // an existing referral.
    if (!req.cookies.get('ts_ref')) {
      res.cookies.set('ts_ref', clean, { maxAge: 60 * 60 * 24 * 30, path: '/' })
    }
    try {
      await createServiceClient().from('referral_clicks').insert({
        code: clean,
        anon_id: req.cookies.get('ts_anon_id')?.value ?? null,
      })
    } catch {
      // never block the redirect on analytics
    }
  }
  return res
}
