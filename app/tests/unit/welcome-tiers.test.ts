import { describe, it, expect } from 'vitest'
import { WELCOME_TIERS, TRIAL_PRICE } from '@/lib/welcome-tiers'
import type { Tier } from '@/lib/entitlements'

const TIERS: Tier[] = ['free', 'trader', 'pro']

describe('WELCOME_TIERS', () => {
  it('covers every tier', () => {
    for (const t of TIERS) expect(WELCOME_TIERS[t]).toBeDefined()
  })

  it('gives every tier exactly six features with no blanks', () => {
    for (const t of TIERS) {
      const c = WELCOME_TIERS[t]
      expect(c.feats).toHaveLength(6)
      for (const f of c.feats) {
        expect(f.t.trim().length).toBeGreaterThan(0)
        expect(f.d.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('has no empty text fields', () => {
    // 'href' is deliberately excluded: it is '' for the 'free' tier (resolved
    // at render time from the username) and is covered by its own semantics
    // in the "routes free..." test below.
    for (const t of TIERS) {
      const c = WELCOME_TIERS[t]
      for (const k of ['aria', 'eyebrow', 'em', 'sub', 'price', 'cta'] as const) {
        expect(c[k].trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('keeps the client copy verbatim, including Unicode punctuation', () => {
    expect(WELCOME_TIERS.free.price).toBe('$0 / month · free forever')
    expect(WELCOME_TIERS.trader.price).toBe('$30 / month · billed monthly')
    expect(WELCOME_TIERS.pro.price).toBe('$50 / month · billed monthly')
    expect(WELCOME_TIERS.pro.em).toBe('Pro Trader')
    expect(WELCOME_TIERS.trader.feats[0].d).toBe('No more 30-trade cap — log everything, forever')
    expect(WELCOME_TIERS.free.sub).toContain('—')
  })

  it('routes free to the profile and paid tiers to the journal', () => {
    expect(WELCOME_TIERS.free.href).toBe('')       // resolved at render from username
    expect(WELCOME_TIERS.trader.href).toBe('/journal')
    expect(WELCOME_TIERS.pro.href).toBe('/journal')
  })

  it('offers a trial price line that does not claim a charge', () => {
    expect(TRIAL_PRICE).toBe('14 days free · then choose a plan')
    expect(TRIAL_PRICE).not.toContain('$')
  })
})
