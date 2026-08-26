import type { Tier } from '@/lib/entitlements'

export const EXPERIENCE_LEVELS = ['beginner', 'intermediate', 'advanced'] as const
export const MARKETS = ['forex', 'crypto', 'stocks', 'indices', 'commodities'] as const
export const TRADING_STYLES = [
  'scalper', 'day trader', 'swing trader', 'position trader', 'investor',
  'algorithmic trader', 'SMC / ICT', 'technical analysis', 'fundamental analysis',
  'momentum', 'mean reversion', 'trend following',
] as const

export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number]

/** Onboarding step 5, "How will you add your trades?" — mandatory, so every
 *  completed onboarding has one. Null only for users who onboarded before the
 *  answer was persisted (migration 0062). */
export const INTENDED_SOURCES = ['broker', 'statement', 'manual'] as const
export type IntendedSource = (typeof INTENDED_SOURCES)[number]

/** Null rather than a default: an unparseable value means we did not learn the
 *  answer, and guessing "manual" would put words in the user's mouth in the one
 *  field that records what they asked us for. Also the CHECK constraint in
 *  migration 0062 rejects anything else, and a rejected value must never reach
 *  the database. */
export function parseIntendedSource(raw: unknown): IntendedSource | null {
  return INTENDED_SOURCES.includes(raw as IntendedSource) ? (raw as IntendedSource) : null
}

export type OnboardingInput = {
  username: string
  experience_level: ExperienceLevel
  main_markets: string[]
  trading_styles: string[]
  goal: string
  is_public: boolean
}

export type ProfileUpdate = OnboardingInput & { onboarding_completed: true }

export function onboardingToRow(input: OnboardingInput): ProfileUpdate {
  return { ...input, onboarding_completed: true }
}

export type Profile = {
  id: string
  username: string
  display_name: string | null
  bio: string | null
  avatar_url: string | null
  experience_level: ExperienceLevel | null
  main_markets: string[] | null
  trading_styles: string[] | null
  goal: string | null
  is_public: boolean
  onboarding_completed: boolean
  xp: number
  level: number
  created_at: string
}

// Private profiles are a paid perk. Free tier is forced public (fail-closed);
// paid tiers may choose. Single source of truth for the visibility gate.
export function resolveVisibility(tier: Tier, requestedPublic: boolean): boolean {
  if (tier === 'free') return true
  return requestedPublic
}
