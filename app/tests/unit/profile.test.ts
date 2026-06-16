import { describe, it, expect } from 'vitest'
import { onboardingToRow, EXPERIENCE_LEVELS, MARKETS, TRADING_STYLES } from '@/lib/profile'

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
