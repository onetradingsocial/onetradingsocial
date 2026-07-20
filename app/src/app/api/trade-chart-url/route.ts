import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getTier } from '@/lib/server/entitlements'
import { getFeatureFlags } from '@/lib/server/feature-flags'
import { canFlag } from '@/lib/feature-flags'
import { signTradeChartUpload, tradeChartPublicUrl } from '@/lib/storage'
import { rateLimit, clientKey, tooMany } from '@/lib/server/rate-limit'

// Signed upload URLs are the main storage-abuse vector, so they are throttled
// well above normal human use but far below what a script would want.
const UPLOAD_MAX = 30
const UPLOAD_WINDOW = 60_000

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const tradeId = searchParams.get('tradeId')
  const ct = searchParams.get('ct')
  if (!tradeId || (ct !== 'image/png' && ct !== 'image/jpeg')) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const rl = rateLimit(clientKey(request, user.id), UPLOAD_MAX, UPLOAD_WINDOW)
  if (!rl.ok) return tooMany(rl.retryAfter)

  // Confirm ownership
  const { data: t } = await supabase.from('trades').select('user_id').eq('id', tradeId).single()
  if (!t || t.user_id !== user.id) return NextResponse.json({ error: 'not found' }, { status: 404 })
  // Chart upload is part of the advanced journal (Trader+).
  const advanced = canFlag(await getFeatureFlags(), await getTier(supabase, user.id), 'advanced_journal')
  if (!advanced) return NextResponse.json({ error: 'Chart upload is a Trader+ perk.' }, { status: 403 })

  const signed = await signTradeChartUpload(user.id, tradeId, ct)
  if ('error' in signed) return NextResponse.json({ error: signed.error }, { status: 500 })
  return NextResponse.json({ ...signed, publicUrl: tradeChartPublicUrl(user.id, tradeId, ct) })
}
