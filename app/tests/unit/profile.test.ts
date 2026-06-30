import { describe, it, expect } from 'vitest'
import { onboardingToRow, EXPERIENCE_LEVELS, MARKETS, TRADING_STYLES, resolveVisibility } from '@/lib/profile'
import type { Tier } from '@/lib/entitlements'

describe('onboardingToRow', () => {
  it('maps onboarding answers to a profile update row', () => {
    const row = onboardingToRow({
      username: 'alex',
      experience_level: 'beginner',
      main_markets: ['forex', 'crypto'],
      trading_styles: ['scalper'],
      goal: 'Get consistent',
      is_public: true,
    })
    expect(row).toEqual({
      username: 'alex',
      experience_level: 'beginner',
      main_markets: ['forex', 'crypto'],
      trading_styles: ['scalper'],
      goal: 'Get consistent',
      is_public: true,
      onboarding_completed: true,
    })
  })

  it('exposes the option lists from the spec', () => {
    expect(EXPERIENCE_LEVELS).toEqual(['beginner', 'intermediate', 'advanced'])
    expect(MARKETS).toContain('indices')
    expect(TRADING_STYLES).toContain('swing trader')
  })
})

describe('resolveVisibility', () => {
  it('forces free tier to public even when private requested', () => {
    expect(resolveVisibility('free', false)).toBe(true)
    expect(resolveVisibility('free', true)).toBe(true)
  })
  it('honors the requested visibility for paid tiers', () => {
    expect(resolveVisibility('trader', false)).toBe(false)
    expect(resolveVisibility('trader', true)).toBe(true)
    expect(resolveVisibility('pro', false)).toBe(false)
    expect(resolveVisibility('pro', true)).toBe(true)
  })
})
