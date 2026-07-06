import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { inferMarket, mapDealToTrade, validateDeals, parseMt5, type Mt5Deal } from '@/lib/mt5'

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

describe('parseMt5 — CSV', () => {
  it('parses semicolon CSV with same headers', () => {
    const r = parseMt5(load('report.csv'), 'report.csv')
    if ('error' in r) throw new Error(r.error)
    expect(r.deals).toHaveLength(2)
    expect(r.deals[1]).toMatchObject({
      ticket: '123457', symbol: 'GBPJPY', direction: 'short', lots: 1,
      stopPrice: null, targetPrice: null,
    })
  })
})

describe('parseMt5 — XLSX', () => {
  it('parses a generated xlsx with the positions layout', () => {
    const XLSX = require('xlsx')
    const rows = [
      ['Positions'],
      ['Time', 'Position', 'Symbol', 'Type', 'Volume', 'Price', 'S / L', 'T / P', 'Time', 'Price', 'Commission', 'Swap', 'Profit'],
      ['2026.06.01 09:30:00', '123456', 'EURUSD', 'buy', '0.50', '1.08500', '1.08200', '1.09100', '2026.06.01 14:45:10', '1.09050', '-2.50', '0.00', '272.50'],
    ]
    const ws = XLSX.utils.aoa_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Report')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const r = parseMt5(buf, 'report.xlsx')
    if ('error' in r) throw new Error(r.error)
    expect(r.deals).toHaveLength(1)
    expect(r.deals[0].ticket).toBe('123456')
  })

  it('parses native numeric cells (real MT5 Open XML exports)', () => {
    const XLSX = require('xlsx')
    const rows = [
      ['Positions'],
      ['Time', 'Position', 'Symbol', 'Type', 'Volume', 'Price', 'S / L', 'T / P', 'Time', 'Price', 'Commission', 'Swap', 'Profit'],
      ['2026.06.01 09:30:00', '123456', 'EURUSD', 'buy', 0.5, 1.085, 1.082, 1.091, '2026.06.01 14:45:10', 1.0905, -2.5, 0, 272.5],
    ]
    const ws = XLSX.utils.aoa_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Report')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const r = parseMt5(buf, 'report.xlsx')
    if ('error' in r) throw new Error(r.error)
    expect(r.deals).toHaveLength(1)
    const d = r.deals[0]
    expect(d).toMatchObject({
      ticket: '123456', symbol: 'EURUSD', direction: 'long', lots: 0.5,
      openPrice: 1.085, closePrice: 1.0905, commission: -2.5, swap: 0, profit: 272.5,
    })
    expect(d.netPnl).toBeCloseTo(270)
  })
})

const deal = (over: Partial<Mt5Deal> = {}): Mt5Deal => ({
  ticket: '123456', symbol: 'EURUSD', direction: 'long', lots: 0.5,
  openTime: '2026-06-01T09:30:00Z', closeTime: '2026-06-01T14:45:10Z',
  openPrice: 1.085, closePrice: 1.0905, stopPrice: 1.082, targetPrice: 1.091,
  commission: -2.5, swap: 0, profit: 272.5, netPnl: 270,
  ...over,
})

describe('inferMarket', () => {
  it('classifies symbols including broker suffixes', () => {
    expect(inferMarket('EURUSD')).toBe('forex')
    expect(inferMarket('GBPJPY.a')).toBe('forex')
    expect(inferMarket('XAUUSD')).toBe('commodities')
    expect(inferMarket('BTCUSD')).toBe('crypto')
    expect(inferMarket('US30')).toBe('indices')
    expect(inferMarket('AAPL')).toBe('stocks')
  })
})

describe('mapDealToTrade', () => {
  const opts = { userId: 'u1', isPublic: true }

  it('maps core fields for a closed win', () => {
    const row = mapDealToTrade(deal(), opts)
    expect(row).toMatchObject({
      user_id: 'u1', broker_deal_id: '123456', instrument: 'EURUSD', market: 'forex',
      direction: 'long', sizing_mode: 'lots', lots: 0.5,
      entry_price: 1.085, exit_price: 1.0905, stop_price: 1.082, target_price: 1.091,
      pnl_amount: 270, status: 'closed', outcome: 'win', is_public: true,
      traded_at: '2026-06-01T09:30:00Z', closed_at: '2026-06-01T14:45:10Z',
    })
  })

  it('computes risk/r-multiple when stop present', () => {
    const row = mapDealToTrade(deal(), opts) as { sl_pips: number; risk_amount: number; r_multiple: number }
    expect(row.sl_pips).toBeCloseTo(30)           // (1.085-1.082)/0.0001
    expect(row.risk_amount).toBeCloseTo(150)      // 30 pips * $10/lot * 0.5
    expect(row.r_multiple).toBeCloseTo(1.8)       // 270 / 150
  })

  it('null stop → zero sl_pips, null r_multiple, null stop_price', () => {
    const row = mapDealToTrade(deal({ stopPrice: null, targetPrice: null }), opts) as Record<string, unknown>
    expect(row.stop_price).toBeNull()
    expect(row.sl_pips).toBe(0)
    expect(row.r_multiple).toBeNull()
    expect(row.risk_amount).toBe(0)
  })

  it('outcome from net pnl sign', () => {
    expect(mapDealToTrade(deal({ netPnl: -50 }), opts).outcome).toBe('loss')
    expect(mapDealToTrade(deal({ netPnl: 0 }), opts).outcome).toBe('breakeven')
  })
})

describe('validateDeals', () => {
  it('accepts a valid array and rejects junk', () => {
    expect('deals' in validateDeals([deal()])).toBe(true)
    expect('error' in validateDeals('nope')).toBe(true)
    expect('error' in validateDeals([{ ...deal(), lots: Infinity }])).toBe(true)
    expect('error' in validateDeals([{ ...deal(), ticket: '' }])).toBe(true)
    expect('error' in validateDeals([{ ...deal(), direction: 'sideways' }])).toBe(true)
    expect('error' in validateDeals(Array(501).fill(deal()))).toBe(true)
  })
})
