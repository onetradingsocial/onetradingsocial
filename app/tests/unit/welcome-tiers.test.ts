import { describe, it, expect } from 'vitest'
import { WELCOME_TIERS, TRIAL_PRICE } from '@/lib/welcome-tiers'
import type { Tier } from '@/lib/entitlements'

const TIERS: Tier[] = ['free', 'trader', 'pro']

describe('WELCOME_TIERS', () => {
  it('covers every tier', () => {
    for (const t of TIERS) expect(WELCOME_TIERS[t]).toBeDefined()
  })

  // Learn hidden for now — we are not financial advisors. Every tier had exactly
  // six features (verbatim from the client mockups). Trader's 'Full beginner &
  // intermediate courses' and Pro's 'Premium courses & psychology modules' are
  // withdrawn, so those two carry five. Put this back to a flat 6 when the
  // learning hub is restored — WelcomeModal reads the count off `feats` now, so
  // the "N features just unlocked" caption follows automatically.
  const EXPECTED_FEATS: Record<Tier, number> = { free: 6, trader: 5, pro: 5 }

  it('gives every tier its full feature list with no blanks', () => {
    for (const t of TIERS) {
      const c = WELCOME_TIERS[t]
      expect(c.feats).toHaveLength(EXPECTED_FEATS[t])
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
    expect(WELCOME_TIERS.free.price).toBe('A$0 / month · free forever')
    expect(WELCOME_TIERS.trader.price).toBe('A$30 / month · billed monthly')
    expect(WELCOME_TIERS.pro.price).toBe('A$50 / month · billed monthly')
    expect(WELCOME_TIERS.pro.em).toBe('Pro Trader')
    // Owner-confirmed: the Stripe prices are AUD. A bare '$' in front of an
    // Australian buyer is a price representation we cannot stand behind, so
    // every quoted amount must carry the A$ prefix.
    for (const t of ['free', 'trader', 'pro'] as const) {
      expect(WELCOME_TIERS[t].price).toMatch(/^A\$/)
      expect(WELCOME_TIERS[t].price).not.toMatch(/(^|[^A])\$/)
    }
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
