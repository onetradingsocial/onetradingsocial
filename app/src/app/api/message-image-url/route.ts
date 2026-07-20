import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { signMessageImageUpload, messageImagePublicUrl } from '@/lib/storage'
import { rateLimit, clientKey, tooMany } from '@/lib/server/rate-limit'

const UPLOAD_MAX = 30
const UPLOAD_WINDOW = 60_000

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const draftId = searchParams.get('draftId')
  const idx = Number(searchParams.get('idx'))
  const ct = searchParams.get('ct')
  if (!draftId || !UUID_RE.test(draftId) || !Number.isInteger(idx) || idx < 0 || idx > 3 || (ct !== 'image/png' && ct !== 'image/jpeg')) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const rl = rateLimit(clientKey(request, user.id), UPLOAD_MAX, UPLOAD_WINDOW)
  if (!rl.ok) return tooMany(rl.retryAfter)
  const signed = await signMessageImageUpload(user.id, draftId, idx, ct)
  if ('error' in signed) return NextResponse.json({ error: signed.error }, { status: 500 })
  return NextResponse.json({ ...signed, publicUrl: messageImagePublicUrl(user.id, draftId, idx, ct) })
}
