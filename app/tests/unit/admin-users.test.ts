import { describe, it, expect } from 'vitest'
import { userTierSummary } from '@/lib/admin-users'
import {
  normalizeAccountFilter, normalizeSubFilter, normalizeCompFilter, isInternalRow,
} from '@/lib/admin-users'

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

describe('filter normalizers', () => {
  it('normalizeAccountFilter defaults to real, passes valid, rejects junk', () => {
    expect(normalizeAccountFilter(undefined)).toBe('real')
    expect(normalizeAccountFilter('all')).toBe('all')
    expect(normalizeAccountFilter('test')).toBe('test')
    expect(normalizeAccountFilter('real')).toBe('real')
    expect(normalizeAccountFilter('bogus')).toBe('real')
  })
  it('normalizeSubFilter defaults to any', () => {
    expect(normalizeSubFilter(undefined)).toBe('any')
    expect(normalizeSubFilter('pro')).toBe('pro')
    expect(normalizeSubFilter('trader')).toBe('trader')
    expect(normalizeSubFilter('free')).toBe('free')
    expect(normalizeSubFilter('x')).toBe('any')
  })
  it('normalizeCompFilter defaults to any', () => {
    expect(normalizeCompFilter(undefined)).toBe('any')
    expect(normalizeCompFilter('comped')).toBe('comped')
    expect(normalizeCompFilter('not')).toBe('not')
    expect(normalizeCompFilter('x')).toBe('any')
  })
})

describe('isInternalRow', () => {
  it('true when flag set', () => {
    expect(isInternalRow({ is_internal: true, email: 'a@gmail.com' })).toBe(true)
  })
  it('true for @tradingsocial.io regardless of flag', () => {
    expect(isInternalRow({ is_internal: false, email: 'lb_hi_1@tradingsocial.io' })).toBe(true)
    expect(isInternalRow({ is_internal: false, email: 'X@TradingSocial.IO' })).toBe(true)
  })
  it('false for a real external user', () => {
    expect(isInternalRow({ is_internal: false, email: 'real@gmail.com' })).toBe(false)
    expect(isInternalRow({ is_internal: null, email: null })).toBe(false)
  })
})
