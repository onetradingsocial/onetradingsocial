import { describe, it, expect } from 'vitest'
import { subscriptionRow } from '@/lib/billing-webhook'
import type { PlanEnv } from '@/lib/entitlements'

const ENV: PlanEnv = {
  STRIPE_PRICE_TRADER_MONTHLY: 'price_tm',
  STRIPE_PRICE_PRO_ANNUAL: 'price_pa',
}

const sub = (priceId: string, over: Record<string, unknown> = {}) => ({
  id: 'sub_1',
  status: 'active',
  cancel_at_period_end: false,
  current_period_end: 1_700_000_000,
  items: { data: [{ price: { id: priceId } }] },
  ...over,
})

describe('subscriptionRow', () => {
  it('maps an active trader monthly subscription', () => {
    expect(subscriptionRow(sub('price_tm'), ENV)).toEqual({
      id: 'sub_1',
      status: 'active',
      tier: 'trader',
      price_id: 'price_tm',
      current_period_end: '2023-11-14T22:13:20.000Z',
      cancel_at_period_end: false,
    })
  })
  it('carries status and cancel flag', () => {
    const row = subscriptionRow(sub('price_pa', { status: 'past_due', cancel_at_period_end: true }), ENV)
    expect(row?.tier).toBe('pro')
    expect(row?.status).toBe('past_due')
    expect(row?.cancel_at_period_end).toBe(true)
  })
  it('returns null for an unknown price (do not 500 the webhook)', () => {
    expect(subscriptionRow(sub('price_unknown'), ENV)).toBeNull()
  })
  it('handles a null current_period_end', () => {
    expect(subscriptionRow(sub('price_tm', { current_period_end: null }), ENV)?.current_period_end).toBeNull()
  })
})
