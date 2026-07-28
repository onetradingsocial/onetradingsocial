import { describe, it, expect } from 'vitest'
import { userTierSummary } from '@/lib/admin-users'

const ADMINS = ['boss@x.com']

describe('userTierSummary', () => {
  it('admin email always resolves to pro/Admin', () => {
    expect(userTierSummary({ email: 'boss@x.com', compTier: null, subTier: null, subStatus: null, adminEmails: ADMINS }))
      .toEqual({ tier: 'pro', source: 'Admin' })
  })
  it('comp tier shows as Comp when no higher paid tier', () => {
    expect(userTierSummary({ email: 'a@x.com', compTier: 'pro', subTier: null, subStatus: null, adminEmails: ADMINS }))
      .toEqual({ tier: 'pro', source: 'Comp' })
  })
  it('active paid sub shows as Paid', () => {
    expect(userTierSummary({ email: 'a@x.com', compTier: null, subTier: 'trader', subStatus: 'active', adminEmails: ADMINS }))
      .toEqual({ tier: 'trader', source: 'Paid' })
  })
  it('higher paid tier wins over lower comp, source is Paid', () => {
    expect(userTierSummary({ email: 'a@x.com', compTier: 'trader', subTier: 'pro', subStatus: 'active', adminEmails: ADMINS }))
      .toEqual({ tier: 'pro', source: 'Paid' })
  })
  it('comp wins over lower paid tier, source is Comp', () => {
    expect(userTierSummary({ email: 'a@x.com', compTier: 'pro', subTier: 'trader', subStatus: 'active', adminEmails: ADMINS }))
      .toEqual({ tier: 'pro', source: 'Comp' })
  })
  it('no comp, no sub → free/Free', () => {
    expect(userTierSummary({ email: 'a@x.com', compTier: null, subTier: null, subStatus: null, adminEmails: ADMINS }))
      .toEqual({ tier: 'free', source: 'Free' })
  })
  it('comp ties with equal paid tier → source is Comp', () => {
    expect(userTierSummary({ email: 'a@x.com', compTier: 'pro', subTier: 'pro', subStatus: 'active', adminEmails: ADMINS }))
      .toEqual({ tier: 'pro', source: 'Comp' })
    expect(userTierSummary({ email: 'a@x.com', compTier: 'trader', subTier: 'trader', subStatus: 'active', adminEmails: ADMINS }))
      .toEqual({ tier: 'trader', source: 'Comp' })
  })
})
