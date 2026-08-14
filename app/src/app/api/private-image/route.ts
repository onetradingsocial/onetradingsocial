import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { signPrivateRead } from '@/lib/storage'

/**
 * Read gateway for the private storage bucket (audit item 07).
 *
 * Trade charts and DM attachments live in `OneTradingSocial-private`, which is
 * `public = false` with owner-only storage RLS, so no browser can fetch them
 * directly. This route is the only way in: it re-derives who may see the object
 * from the SAME rules the database already enforces on the owning row, then
 * hands out a short-TTL signed URL.
 *
 * Owner-only would be wrong here. A PUBLIC trade's chart is meant to be visible
 * to everyone -- it renders in the feed and on public profiles for logged-out
 * visitors -- so authorisation has to follow `trades_select`, not the storage
 * key's uid. That is exactly why storage RLS alone cannot be the read path.
 *
 * The `key` is caller-supplied, so it is matched against a strict shape before
 * anything else: only the two private prefixes, only UUID segments, only the
 * two extensions the uploaders can produce. There is no path traversal to find
 * because nothing outside those two patterns is accepted.
 */

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const TRADE_KEY = new RegExp(`^trades/(${UUID})/(${UUID})\\.(png|jpg)$`, 'i')
const MESSAGE_KEY = new RegExp(`^messages/(${UUID})/${UUID}/[0-3]\\.(png|jpg)$`, 'i')

function deny(status: number) {
  return NextResponse.json({ error: status === 401 ? 'unauthorized' : 'not found' }, { status })
}

export async function GET(request: NextRequest) {
  const key = new URL(request.url).searchParams.get('key')
  if (!key) return NextResponse.json({ error: 'bad request' }, { status: 400 })

  const trade = TRADE_KEY.exec(key)
  const message = MESSAGE_KEY.exec(key)
  if (!trade && !message) return NextResponse.json({ error: 'bad request' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (trade) {
    const [, ownerId, tradeId] = trade
    // The user client is the authorisation: trades_select is
    // `is_public or auth.uid() = user_id`, so an unreadable trade comes back
    // empty for this viewer and we never reach the signing step.
    const { data: t } = await supabase.from('trades').select('user_id').eq('id', tradeId).maybeSingle()
    // 404 rather than 401 even for logged-out callers: whether a private trade
    // exists is itself something the viewer is not entitled to learn.
    if (!t || t.user_id !== ownerId) return deny(404)
  } else if (message) {
    const [, senderId] = message
    if (!user) return deny(401)
    if (user.id !== senderId) {
      // Not the sender, so the only way in is being the other participant of a
      // conversation this image was actually sent in. The messages RLS policy
      // (participant-only) does the work; a non-participant matches no row.
      const { data: m } = await supabase
        .from('messages')
        .select('id')
        .eq('sender_id', senderId)
        .contains('attachments', [{ type: 'image', url: `/api/private-image?key=${key}` }])
        .limit(1)
        .maybeSingle()
      if (!m) return deny(404)
    }
  }

  const signed = await signPrivateRead(key)
  if (!signed) return deny(404)

  // The redirect itself must never be cached: it carries a bearer token that
  // expires, and the viewer who may follow it can change.
  return NextResponse.redirect(signed, {
    status: 302,
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
}
