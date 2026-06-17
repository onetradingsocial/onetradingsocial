import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { signTradeChartUpload, tradeChartPublicUrl } from '@/lib/storage'

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
  // Confirm ownership
  const { data: t } = await supabase.from('trades').select('user_id').eq('id', tradeId).single()
  if (!t || t.user_id !== user.id) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const signed = await signTradeChartUpload(user.id, tradeId, ct)
  if ('error' in signed) return NextResponse.json({ error: signed.error }, { status: 500 })
  return NextResponse.json({ ...signed, publicUrl: tradeChartPublicUrl(user.id, tradeId, ct) })
}
