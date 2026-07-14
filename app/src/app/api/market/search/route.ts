import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { searchSymbols, TtlCache, type MarketSearchResult } from '@/lib/market-data'

const DAY_MS = 24 * 60 * 60 * 1000
const cache = new TtlCache<MarketSearchResult[]>(1000)

export async function GET(request: NextRequest) {
  const q = (new URL(request.url).searchParams.get('q') ?? '').trim()
  if (q.length < 2 || q.length > 30) return NextResponse.json({ results: [] })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const key = q.toLowerCase()
  const hit = cache.get(key)
  if (hit) return NextResponse.json({ results: hit.value })

  const results = await searchSymbols(q, process.env.TWELVEDATA_API_KEY ?? '')
  cache.set(key, results, DAY_MS)
  return NextResponse.json(
    { results },
    { headers: { 'Cache-Control': 'private, max-age=3600' } },
  )
}
