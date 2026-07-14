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
