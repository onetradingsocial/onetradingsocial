import { INSTRUMENTS } from '@/lib/instruments'

export type Market = 'forex' | 'crypto' | 'stocks' | 'indices' | 'commodities'
export type MarketSearchResult = { symbol: string; name: string; market: Market; exchange?: string }
export type MarketQuote = { symbol: string; price: number; at: number; proxy?: string }

// Free-tier Twelve Data has no index CFD data; quote these via ETF proxies.
export const INDEX_PROXIES: Record<string, string> = {
  US30: 'DIA', NAS100: 'QQQ', SPX500: 'SPY', GER40: 'EWG',
}

export function mapInstrumentType(instrumentType: string, symbol: string): Market {
  const t = instrumentType.toLowerCase()
  const s = symbol.toUpperCase()
  if (s.startsWith('XAU') || s.startsWith('XAG')) return 'commodities'
  if (t.includes('digital')) return 'crypto'
  if (t.includes('currency')) return 'forex'
  if (t.includes('index')) return 'indices'
  return 'stocks'
}

export function searchStatic(q: string): MarketSearchResult[] {
  const s = q.trim().toUpperCase()
  if (!s) return []
  return INSTRUMENTS
    .filter((i) => i.symbol.toUpperCase().includes(s) || i.name.toUpperCase().includes(s))
    .map((i) => ({ symbol: i.symbol, name: i.name, market: i.market }))
}

export function mergeSearchResults(
  staticHits: MarketSearchResult[],
  apiHits: MarketSearchResult[],
): MarketSearchResult[] {
  const seen = new Set(staticHits.map((r) => r.symbol.toUpperCase()))
  const out = [...staticHits]
  for (const r of apiHits) {
    const key = r.symbol.toUpperCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out.slice(0, 20)
}

type CacheEntry<T> = { value: T; freshUntil: number; expiresAt: number }

export class TtlCache<T> {
  private map = new Map<string, CacheEntry<T>>()
  constructor(private maxEntries = 500) {}

  get(key: string, now = Date.now()): { value: T; stale: boolean } | null {
    const e = this.map.get(key)
    if (!e) return null
    if (now >= e.expiresAt) { this.map.delete(key); return null }
    return { value: e.value, stale: now >= e.freshUntil }
  }

  set(key: string, value: T, freshMs: number, staleMs = 0, now = Date.now()) {
    if (!this.map.has(key) && this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value
      if (oldest !== undefined) this.map.delete(oldest)
    }
    this.map.set(key, { value, freshUntil: now + freshMs, expiresAt: now + freshMs + staleMs })
  }
}

const TD_BASE = 'https://api.twelvedata.com'
const US_EXCHANGES = new Set(['NASDAQ', 'NYSE', 'AMEX', 'NYSE ARCA', 'ARCA', 'BATS', 'OTC'])

type TdSearchRow = {
  symbol?: string
  instrument_name?: string
  exchange?: string
  instrument_type?: string
}

export async function searchSymbols(
  q: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MarketSearchResult[]> {
  const staticHits = searchStatic(q)
  if (!apiKey) return staticHits
  try {
    const url = `${TD_BASE}/symbol_search?symbol=${encodeURIComponent(q.trim())}&outputsize=30&apikey=${apiKey}`
    const res = await fetchImpl(url)
    if (!res.ok) return staticHits
    const json = (await res.json()) as { data?: TdSearchRow[] }
    const rows = Array.isArray(json?.data) ? json.data : []
    const apiHits: MarketSearchResult[] = []
    for (const row of rows) {
      if (!row.symbol) continue
      const market = mapInstrumentType(row.instrument_type ?? '', row.symbol)
      // Free tier only quotes US stock listings; skip foreign listings to
      // avoid offering symbols the quote endpoint will reject.
      if (market === 'stocks' && !US_EXCHANGES.has((row.exchange ?? '').toUpperCase())) continue
      apiHits.push({
        symbol: row.symbol.toUpperCase(),
        name: row.instrument_name ?? row.symbol,
        market,
        exchange: row.exchange || undefined,
      })
    }
    return mergeSearchResults(staticHits, apiHits)
  } catch {
    return staticHits
  }
}

export async function fetchQuote(
  symbol: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MarketQuote | { error: 'not_found' | 'rate_limited' | 'unavailable' }> {
  if (!apiKey) return { error: 'unavailable' }
  const sym = symbol.trim().toUpperCase()
  const proxy = INDEX_PROXIES[sym]
  const target = proxy ?? sym
  try {
    const res = await fetchImpl(`${TD_BASE}/price?symbol=${encodeURIComponent(target)}&apikey=${apiKey}`)
    const json = (await res.json().catch(() => null)) as { price?: string; code?: number } | null
    if (json && typeof json.price === 'string') {
      const price = Number(json.price)
      if (Number.isFinite(price)) {
        return proxy ? { symbol: sym, price, at: Date.now(), proxy } : { symbol: sym, price, at: Date.now() }
      }
    }
    if (res.status === 429 || json?.code === 429) return { error: 'rate_limited' }
    return { error: 'not_found' }
  } catch {
    return { error: 'unavailable' }
  }
}
