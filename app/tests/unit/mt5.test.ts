import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseMt5 } from '@/lib/mt5'

const FIX = join(__dirname, '..', 'fixtures', 'mt5')
const load = (name: string) => {
  const b = readFileSync(join(FIX, name))
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}

describe('parseMt5 — HTML report', () => {
  const res = parseMt5(load('report.html'), 'report.html')

  it('parses all closed positions, ignores Orders/Results sections', () => {
    expect('deals' in res && res.deals).toHaveLength(3)
  })

  it('maps a buy position', () => {
    if ('error' in res) throw new Error(res.error)
    const d = res.deals[0]
    expect(d).toMatchObject({
      ticket: '123456', symbol: 'EURUSD', direction: 'long', lots: 0.5,
      openPrice: 1.085, closePrice: 1.0905, stopPrice: 1.082, targetPrice: 1.091,
      commission: -2.5, swap: 0, profit: 272.5,
    })
    expect(d.netPnl).toBeCloseTo(270)
    expect(d.openTime).toBe('2026-06-01T09:30:00Z')
    expect(d.closeTime).toBe('2026-06-01T14:45:10Z')
  })

  it('handles sell, missing S/L-T/P, suffixed symbol, thousands separators', () => {
    if ('error' in res) throw new Error(res.error)
    const d = res.deals[1]
    expect(d).toMatchObject({
      ticket: '123457', symbol: 'XAUUSD.a', direction: 'short', lots: 0.1,
      openPrice: 2350, closePrice: 2362.5, stopPrice: null, targetPrice: null,
    })
    expect(d.netPnl).toBeCloseTo(-1252)
  })

  it('breakeven position parses with zero net', () => {
    if ('error' in res) throw new Error(res.error)
    expect(res.deals[2].netPnl).toBe(0)
  })

  it('rejects a file with no Positions table', () => {
    const junk = new TextEncoder().encode('<html><body><p>hello</p></body></html>').buffer as ArrayBuffer
    const r = parseMt5(junk, 'junk.html')
    expect('error' in r).toBe(true)
  })
})
