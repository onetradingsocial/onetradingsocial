import { describe, it, expect } from 'vitest'
import { verifyReadOnly, type BinanceClient } from '@/lib/server/binance'

// A fake CCXT-like client whose apiRestrictions payload we control.
const clientWith = (restrictions: Record<string, unknown>): BinanceClient => ({
  fetchMyTrades: async () => [],
  sapiGetAccountApiRestrictions: async () => restrictions,
})

const READ_ONLY = {
  enableWithdrawals: false,
  enableInternalTransfer: false,
  enableSpotAndMarginTrading: false,
  enableFutures: false,
  enableMargin: false,
}

describe('verifyReadOnly', () => {
  it('accepts a strictly read-only key', async () => {
    const res = await verifyReadOnly({ apiKey: 'k', apiSecret: 's' }, clientWith(READ_ONLY))
    expect(res).toEqual({ ok: true })
  })

  it('rejects a key that can withdraw', async () => {
    const res = await verifyReadOnly({ apiKey: 'k', apiSecret: 's' },
      clientWith({ ...READ_ONLY, enableWithdrawals: true }))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/withdraw/i)
  })

  it('rejects a key that can trade spot/margin', async () => {
    const res = await verifyReadOnly({ apiKey: 'k', apiSecret: 's' },
      clientWith({ ...READ_ONLY, enableSpotAndMarginTrading: true }))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/trade/i)
  })

  it('rejects a key that can trade futures', async () => {
    const res = await verifyReadOnly({ apiKey: 'k', apiSecret: 's' },
      clientWith({ ...READ_ONLY, enableFutures: true }))
    expect(res.ok).toBe(false)
  })

  it('reports a read failure without leaking the key', async () => {
    const throwing: BinanceClient = {
      fetchMyTrades: async () => [],
      sapiGetAccountApiRestrictions: async () => { throw new Error('Invalid Api-Key ID') },
    }
    const res = await verifyReadOnly({ apiKey: 'SECRET_KEY', apiSecret: 's' }, throwing)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).not.toContain('SECRET_KEY')
      expect(res.reason).toMatch(/could not|check/i)
    }
  })
})
