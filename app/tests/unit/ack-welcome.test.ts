import { describe, it, expect } from 'vitest'
import { isTier } from '@/lib/entitlements'

describe('isTier validation predicate', () => {
  describe('accepts known tiers', () => {
    it('accepts free', () => {
      expect(isTier('free')).toBe(true)
    })
    it('accepts trader', () => {
      expect(isTier('trader')).toBe(true)
    })
    it('accepts pro', () => {
      expect(isTier('pro')).toBe(true)
    })
  })

  describe('rejects Object.prototype keys that `in` would accept', () => {
    it('rejects toString', () => {
      expect(isTier('toString')).toBe(false)
    })
    it('rejects constructor', () => {
      expect(isTier('constructor')).toBe(false)
    })
    it('rejects valueOf', () => {
      expect(isTier('valueOf')).toBe(false)
    })
    it('rejects hasOwnProperty', () => {
      expect(isTier('hasOwnProperty')).toBe(false)
    })
    it('rejects __proto__', () => {
      expect(isTier('__proto__')).toBe(false)
    })
  })

  describe('rejects other invalid strings', () => {
    it('rejects empty string', () => {
      expect(isTier('')).toBe(false)
    })
    it('rejects case variants (uppercase PRO)', () => {
      expect(isTier('PRO')).toBe(false)
    })
    it('rejects case variants (title case Free)', () => {
      expect(isTier('Free')).toBe(false)
    })
    it('rejects unknown tier names (admin)', () => {
      expect(isTier('admin')).toBe(false)
    })
    it('rejects unknown tier names (gold)', () => {
      expect(isTier('gold')).toBe(false)
    })
    it('rejects partial matches (fr)', () => {
      expect(isTier('fr')).toBe(false)
    })
    it('rejects with whitespace (free with space)', () => {
      expect(isTier(' free')).toBe(false)
      expect(isTier('free ')).toBe(false)
    })
  })
})
