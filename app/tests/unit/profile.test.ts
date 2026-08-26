import { describe, it, expect } from 'vitest'
import { onboardingToRow, parseIntendedSource, INTENDED_SOURCES, EXPERIENCE_LEVELS, MARKETS, TRADING_STYLES, resolveVisibility } from '@/lib/profile'
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

/**
 * Onboarding step 5 is mandatory, so a completed onboarding always carries an
 * answer — but the value arrives as untyped FormData, and the column has a
 * CHECK constraint (migration 0062). An unrecognised value must become NULL and
 * not a guess: this is the field recording what the user asked us for, and
 * defaulting it to 'manual' would put words in their mouth.
 */
describe('parseIntendedSource', () => {
  it('accepts each of the three declared methods', () => {
    for (const s of INTENDED_SOURCES) expect(parseIntendedSource(s)).toBe(s)
  })

  it('nulls anything the CHECK constraint would reject', () => {
    // A rejected value must not reach the database — the insert would fail and
    // take the whole of onboarding down with it.
    for (const bad of ['', 'Broker', 'mt5', 'MANUAL', 'null', ' manual']) {
      expect(parseIntendedSource(bad)).toBeNull()
    }
  })

  it('nulls a missing or non-string field rather than coercing it', () => {
    expect(parseIntendedSource(null)).toBeNull()
    expect(parseIntendedSource(undefined)).toBeNull()
    expect(parseIntendedSource(0)).toBeNull()
    expect(parseIntendedSource({})).toBeNull()
  })
})
