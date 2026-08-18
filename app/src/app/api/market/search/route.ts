import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { searchSymbols, TtlCache, type MarketSearchResult } from '@/lib/market-data'
import { spendMarketCredit } from '@/lib/server/market-quota'

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

  // Audit item 10 F2. Unlike `quote`, search has no stale fallback to offer, so
  // over-budget returns an empty result set rather than a 429: the caller is
  // the symbol-picker typeahead, and an empty list degrades to the static
  // instrument list the UI already falls back to when the key is unset. A 429
  // here would surface as a broken control mid-keystroke.
  const spend = await spendMarketCredit(user.id)
  if (!spend.ok) return NextResponse.json({ results: [], throttled: true })

  const results = await searchSymbols(q, process.env.TWELVEDATA_API_KEY ?? '')
  cache.set(key, results, DAY_MS)
  return NextResponse.json(
    { results },
    { headers: { 'Cache-Control': 'private, max-age=3600' } },
  )
}
