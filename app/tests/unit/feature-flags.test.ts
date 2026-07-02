import { describe, it, expect } from 'vitest'
import {
  flagsFromRows, canFlag, defaultMatrix, isFeature, FEATURE_KEYS,
} from '@/lib/feature-flags'
import { FEATURE_MIN_TIER } from '@/lib/entitlements'

describe('canFlag', () => {
  it('falls back to static defaults when no row exists', () => {
    expect(canFlag({}, 'trader', 'journal_unlimited')).toBe(true)
    expect(canFlag({}, 'free', 'journal_unlimited')).toBe(false)
    expect(canFlag({}, 'trader', 'pro_badge')).toBe(false)
    expect(canFlag({}, 'pro', 'pro_badge')).toBe(true)
  })
  it('uses the DB override when a row exists', () => {
    const flags = flagsFromRows([
      { feature: 'journal_unlimited', free: true, trader: false, pro: true },
    ])
    expect(canFlag(flags, 'free', 'journal_unlimited')).toBe(true)
    expect(canFlag(flags, 'trader', 'journal_unlimited')).toBe(false)
    expect(canFlag(flags, 'pro', 'journal_unlimited')).toBe(true)
  })
})

describe('flagsFromRows', () => {
  it('drops rows whose feature key is not in the registry', () => {
    expect(flagsFromRows([{ feature: 'nope', free: true, trader: true, pro: true }]))
      .toEqual({})
  })
})

describe('defaultMatrix', () => {
  it('mirrors min-tier semantics', () => {
    expect(defaultMatrix('journal_unlimited')).toEqual({ free: false, trader: true, pro: true })
    expect(defaultMatrix('pro_badge')).toEqual({ free: false, trader: false, pro: true })
  })
})

describe('registry', () => {
  it('FEATURE_KEYS covers every FEATURE_MIN_TIER key', () => {
    expect(FEATURE_KEYS.sort()).toEqual(Object.keys(FEATURE_MIN_TIER).sort())
  })
  it('isFeature accepts registry keys and rejects others', () => {
    expect(isFeature('journal_unlimited')).toBe(true)
    expect(isFeature('made_up')).toBe(false)
  })
})
