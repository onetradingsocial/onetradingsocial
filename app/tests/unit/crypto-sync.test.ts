import { describe, it, expect } from 'vitest'
import { planImport } from '@/lib/server/crypto-sync'
import type { Fill } from '@/lib/crypto/fills'

const f = (o: Partial<Fill> & { id: string; side: 'buy' | 'sell'; price: number; amount: number; timestamp: number }): Fill => ({
  symbol: 'BTC/USDT', ...o,
})

describe('planImport', () => {
  it('rolls a closed cycle into one prefixed, broker-sourced row', () => {
    const res = planImport([
      f({ id: '1', side: 'buy', price: 100, amount: 1, timestamp: 1000 }),
      f({ id: '2', side: 'sell', price: 110, amount: 1, timestamp: 2000 }),
    ], { userId: 'u1', isPublic: true, exchange: 'binance' })
    expect(res.rows).toHaveLength(1)
    expect(res.rows[0]).toMatchObject({
      user_id: 'u1', broker_deal_id: 'binance:2', source: 'broker',
      instrument: 'BTC/USD', pnl_amount: 10, status: 'closed',
    })
  })

  it('reports the cursor as the max fill timestamp', () => {
    const res = planImport([
      f({ id: '1', side: 'buy', price: 100, amount: 1, timestamp: 1000 }),
      f({ id: '2', side: 'sell', price: 110, amount: 1, timestamp: 5000 }),
    ], { userId: 'u1', isPublic: true, exchange: 'binance' })
    expect(res.cursor).toBe(5000)
  })

  it('emits no rows and a null cursor for no fills', () => {
    const res = planImport([], { userId: 'u1', isPublic: true, exchange: 'binance' })
    expect(res.rows).toEqual([])
    expect(res.cursor).toBeNull()
  })

  it('still advances the cursor when fills are all still-open (no closed cycle)', () => {
    const res = planImport([
      f({ id: '1', side: 'buy', price: 100, amount: 1, timestamp: 4000 }),
    ], { userId: 'u1', isPublic: true, exchange: 'binance' })
    expect(res.rows).toEqual([])
    expect(res.cursor).toBe(4000) // so the open position isn't re-fetched from scratch next run
  })
})
