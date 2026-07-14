import { describe, it, expect } from 'vitest'
import {
  mapInstrumentType, searchStatic, mergeSearchResults, TtlCache, INDEX_PROXIES,
  type MarketSearchResult,
} from '@/lib/market-data'

describe('mapInstrumentType', () => {
  it('maps digital currency to crypto', () => {
    expect(mapInstrumentType('Digital Currency', 'BTC/USD')).toBe('crypto')
  })
  it('maps physical currency to forex', () => {
    expect(mapInstrumentType('Physical Currency', 'EUR/USD')).toBe('forex')
  })
  it('maps XAU pairs to commodities even when typed as currency', () => {
    expect(mapInstrumentType('Physical Currency', 'XAU/USD')).toBe('commodities')
    expect(mapInstrumentType('Physical Currency', 'XAG/USD')).toBe('commodities')
  })
  it('maps index to indices', () => {
    expect(mapInstrumentType('Index', 'SPX')).toBe('indices')
  })
  it('defaults everything else to stocks', () => {
    expect(mapInstrumentType('Common Stock', 'AAPL')).toBe('stocks')
    expect(mapInstrumentType('ETF', 'SPY')).toBe('stocks')
    expect(mapInstrumentType('', 'ZZZ')).toBe('stocks')
  })
})

describe('searchStatic', () => {
  it('matches by symbol substring, case-insensitive', () => {
    expect(searchStatic('eur').some((r) => r.symbol === 'EUR/USD')).toBe(true)
  })
  it('matches by name substring', () => {
    expect(searchStatic('gold').some((r) => r.symbol === 'XAU/USD')).toBe(true)
  })
  it('returns empty for blank query', () => {
    expect(searchStatic('  ')).toEqual([])
  })
})

describe('mergeSearchResults', () => {
  const s: MarketSearchResult[] = [{ symbol: 'EUR/USD', name: 'Euro / US Dollar', market: 'forex' }]
  it('keeps static hits first and dedupes by symbol', () => {
    const api: MarketSearchResult[] = [
      { symbol: 'EUR/USD', name: 'Euro US Dollar', market: 'forex', exchange: 'FOREX' },
      { symbol: 'EUR/GBP', name: 'Euro / Pound', market: 'forex' },
    ]
    const out = mergeSearchResults(s, api)
    expect(out[0]).toEqual(s[0])
    expect(out.filter((r) => r.symbol === 'EUR/USD')).toHaveLength(1)
    expect(out.some((r) => r.symbol === 'EUR/GBP')).toBe(true)
  })
  it('caps output at 20', () => {
    const api = Array.from({ length: 30 }, (_, i) => ({
      symbol: `SYM${i}`, name: `Name ${i}`, market: 'stocks' as const,
    }))
    expect(mergeSearchResults(s, api)).toHaveLength(20)
  })
})

describe('TtlCache', () => {
  it('returns fresh value within freshMs', () => {
    const c = new TtlCache<number>()
    c.set('k', 1, 1000, 0, 0)
    expect(c.get('k', 500)).toEqual({ value: 1, stale: false })
  })
  it('returns stale value between freshMs and freshMs+staleMs', () => {
    const c = new TtlCache<number>()
    c.set('k', 1, 1000, 5000, 0)
    expect(c.get('k', 2000)).toEqual({ value: 1, stale: true })
  })
  it('returns null after full expiry', () => {
    const c = new TtlCache<number>()
    c.set('k', 1, 1000, 1000, 0)
    expect(c.get('k', 3000)).toBeNull()
  })
  it('evicts oldest entry when over capacity', () => {
    const c = new TtlCache<number>(2)
    c.set('a', 1, 1000, 0, 0)
    c.set('b', 2, 1000, 0, 0)
    c.set('c', 3, 1000, 0, 0)
    expect(c.get('a', 1)).toBeNull()
    expect(c.get('c', 1)).toEqual({ value: 3, stale: false })
  })
})

describe('INDEX_PROXIES', () => {
  it('maps the four CFD indices to ETFs', () => {
    expect(INDEX_PROXIES).toEqual({ US30: 'DIA', NAS100: 'QQQ', SPX500: 'SPY', GER40: 'EWG' })
  })
})
