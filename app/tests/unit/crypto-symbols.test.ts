import { describe, it, expect } from 'vitest'
import {
  normalizeExchangeSymbol, normalizeCurrency, quoteCurrency, STABLE_QUOTES,
} from '@/lib/crypto/symbols'

describe('normalizeCurrency', () => {
  it('maps every stable quote to USD', () => {
    for (const q of STABLE_QUOTES) expect(normalizeCurrency(q)).toBe('USD')
    expect(STABLE_QUOTES).toHaveLength(6)
  })
  it('upper-cases and leaves non-stables alone', () => {
    expect(normalizeCurrency('btc')).toBe('BTC')
    expect(normalizeCurrency('USD')).toBe('USD')
  })
})

describe('normalizeExchangeSymbol', () => {
  it('normalizes unified stable pairs to USD', () => {
    expect(normalizeExchangeSymbol('BTC/USDT')).toEqual({ instrument: 'BTC/USD', market: 'crypto' })
    expect(normalizeExchangeSymbol('BTC/USDC').instrument).toBe('BTC/USD')
    expect(normalizeExchangeSymbol('BTC/BUSD').instrument).toBe('BTC/USD')
    expect(normalizeExchangeSymbol('BTC/FDUSD').instrument).toBe('BTC/USD')
    expect(normalizeExchangeSymbol('BTC/TUSD').instrument).toBe('BTC/USD')
    expect(normalizeExchangeSymbol('BTC/DAI').instrument).toBe('BTC/USD')
  })
  it('handles the slashless exchange form', () => {
    expect(normalizeExchangeSymbol('BTCUSDT').instrument).toBe('BTC/USD')
    expect(normalizeExchangeSymbol('ETHUSD').instrument).toBe('ETH/USD')
    expect(normalizeExchangeSymbol('ETHBTC').instrument).toBe('ETH/BTC')
  })
  it('strips the CCXT futures settlement suffix', () => {
    expect(normalizeExchangeSymbol('BTC/USDT:USDT').instrument).toBe('BTC/USD')
  })
  it('keeps crypto-quoted pairs verbatim', () => {
    expect(normalizeExchangeSymbol('ETH/BTC').instrument).toBe('ETH/BTC')
  })
  it('upper-cases lowercase input', () => {
    expect(normalizeExchangeSymbol('sol/usdt').instrument).toBe('SOL/USD')
  })
  it('passes through an unsplittable symbol', () => {
    expect(normalizeExchangeSymbol('foobar').instrument).toBe('FOOBAR')
  })
})

describe('quoteCurrency', () => {
  it('extracts the quote from both forms', () => {
    expect(quoteCurrency('BTC/USDT')).toBe('USDT')
    expect(quoteCurrency('BTCUSDT')).toBe('USDT')
    expect(quoteCurrency('BTC/USDT:USDT')).toBe('USDT')
  })
  it('returns empty string when it cannot split', () => {
    expect(quoteCurrency('FOOBAR')).toBe('')
  })
})
