import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchQuote, TtlCache, type MarketQuote } from '@/lib/market-data'

const FRESH_MS = 60 * 1000
const STALE_MS = 60 * 60 * 1000 // keep 1h; served only when provider rate-limits
const cache = new TtlCache<MarketQuote>(500)

export async function GET(request: NextRequest) {
  const symbol = (new URL(request.url).searchParams.get('symbol') ?? '').trim().toUpperCase()
  if (!symbol || symbol.length > 20) return NextResponse.json({ error: 'bad request' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const hit = cache.get(symbol)
  if (hit && !hit.stale) {
    return NextResponse.json({ quote: hit.value }, { headers: { 'Cache-Control': 'private, max-age=30' } })
  }

  const result = await fetchQuote(symbol, process.env.TWELVEDATA_API_KEY ?? '')
  if ('error' in result) {
    if (result.error === 'rate_limited' && hit) return NextResponse.json({ quote: hit.value, stale: true })
    if (result.error === 'not_found') return NextResponse.json({ unavailable: true }, { status: 404 })
    return NextResponse.json({ unavailable: true }, { status: 503 })
  }

  cache.set(symbol, result, FRESH_MS, STALE_MS)
  return NextResponse.json({ quote: result }, { headers: { 'Cache-Control': 'private, max-age=30' } })
}
