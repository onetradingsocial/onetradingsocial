import { describe, it, expect } from 'vitest'
import { findInstrument, pipInfo, INSTRUMENTS } from '@/lib/instruments'

describe('instruments', () => {
  it('finds a catalog instrument case-insensitively', () => {
    expect(findInstrument('eur/usd')?.symbol).toBe('EUR/USD')
  })
  it('catalog has a pip value for majors', () => {
    expect(findInstrument('EUR/USD')?.pipValuePerLot).toBe(10)
  })
  it('pipInfo uses catalog when available', () => {
    expect(pipInfo('EUR/USD', 'forex')).toEqual({ pipSize: 0.0001, pipValuePerLot: 10 })
  })
  it('infers 0.01 pip size for custom JPY forex pair', () => {
    expect(pipInfo('AUD/JPY', 'forex')).toEqual({ pipSize: 0.01, pipValuePerLot: null })
  })
  it('infers 0.0001 for custom non-JPY forex pair', () => {
    expect(pipInfo('EUR/PLN', 'forex')).toEqual({ pipSize: 0.0001, pipValuePerLot: null })
  })
  it('infers pip size 1 for non-forex custom instrument', () => {
    expect(pipInfo('TSLA', 'stocks')).toEqual({ pipSize: 1, pipValuePerLot: null })
  })
  it('exposes a non-empty catalog', () => {
    expect(INSTRUMENTS.length).toBeGreaterThan(10)
  })
})

describe('crypto catalog', () => {
  it('carries the majors the exchange sync will emit', () => {
    for (const s of ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'BNB/USD', 'DOGE/USD', 'ADA/USD']) {
      const found = findInstrument(s)
      expect(found, s).toBeDefined()
      expect(found!.market).toBe('crypto')
    }
  })
})
