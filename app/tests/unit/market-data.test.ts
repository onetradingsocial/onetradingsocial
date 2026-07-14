import { describe, it, expect } from 'vitest'
import {
  mapInstrumentType, searchStatic, mergeSearchResults, TtlCache, INDEX_PROXIES,
  searchSymbols, fetchQuote,
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

function fakeFetch(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  ) as unknown as typeof fetch
}

describe('searchSymbols', () => {
  it('returns static hits only when no api key', async () => {
    const out = await searchSymbols('EUR', '', fakeFetch({ data: [] }))
    expect(out.length).toBeGreaterThan(0)
    expect(out.every((r) => r.exchange === undefined)).toBe(true)
  })
  it('merges api hits after static hits', async () => {
    const out = await searchSymbols('AAPL', 'key', fakeFetch({
      data: [{ symbol: 'AAPL', instrument_name: 'Apple Inc', exchange: 'NASDAQ', instrument_type: 'Common Stock' }],
    }))
    expect(out.some((r) => r.symbol === 'AAPL' && r.market === 'stocks' && r.exchange === 'NASDAQ')).toBe(true)
  })
  it('drops non-US stock listings', async () => {
    const out = await searchSymbols('AAPL', 'key', fakeFetch({
      data: [{ symbol: 'APC', instrument_name: 'Apple Inc', exchange: 'XETRA', instrument_type: 'Common Stock' }],
    }))
    expect(out.some((r) => r.symbol === 'APC')).toBe(false)
  })
  it('keeps forex hits regardless of exchange', async () => {
    const out = await searchSymbols('EUR/PLN', 'key', fakeFetch({
      data: [{ symbol: 'EUR/PLN', instrument_name: 'Euro Polish Zloty', exchange: 'FOREX', instrument_type: 'Physical Currency' }],
    }))
    expect(out.some((r) => r.symbol === 'EUR/PLN' && r.market === 'forex')).toBe(true)
  })
  it('falls back to static hits on fetch failure', async () => {
    const boom = (async () => { throw new Error('net') }) as unknown as typeof fetch
    const out = await searchSymbols('EUR', 'key', boom)
    expect(out.some((r) => r.symbol === 'EUR/USD')).toBe(true)
  })
})

describe('fetchQuote', () => {
  it('returns unavailable without api key', async () => {
    expect(await fetchQuote('EUR/USD', '', fakeFetch({}))).toEqual({ error: 'unavailable' })
  })
  it('parses a price', async () => {
    const r = await fetchQuote('EUR/USD', 'key', fakeFetch({ price: '1.08423' }))
    expect(r).toMatchObject({ symbol: 'EUR/USD', price: 1.08423 })
    expect('proxy' in r).toBe(false)
  })
  it('quotes index CFDs via ETF proxy and flags it', async () => {
    let requested = ''
    const f = (async (url: RequestInfo | URL) => {
      requested = String(url)
      return new Response(JSON.stringify({ price: '442.10' }), { status: 200 })
    }) as unknown as typeof fetch
    const r = await fetchQuote('US30', 'key', f)
    expect(requested).toContain('symbol=DIA')
    expect(r).toMatchObject({ symbol: 'US30', price: 442.10, proxy: 'DIA' })
  })
  it('maps provider 429 body to rate_limited', async () => {
    const r = await fetchQuote('EUR/USD', 'key', fakeFetch({ code: 429, message: 'limit', status: 'error' }))
    expect(r).toEqual({ error: 'rate_limited' })
  })
  it('maps unknown symbol to not_found', async () => {
    const r = await fetchQuote('NOPE', 'key', fakeFetch({ code: 400, message: 'not found', status: 'error' }))
    expect(r).toEqual({ error: 'not_found' })
  })
  it('maps network failure to unavailable', async () => {
    const boom = (async () => { throw new Error('net') }) as unknown as typeof fetch
    expect(await fetchQuote('EUR/USD', 'key', boom)).toEqual({ error: 'unavailable' })
  })
})
