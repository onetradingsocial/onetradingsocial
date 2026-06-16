export const EXPERIENCE_LEVELS = ['beginner', 'intermediate', 'advanced'] as const
export const MARKETS = ['forex', 'crypto', 'stocks', 'indices', 'commodities'] as const
export const TRADING_STYLES = [
  'scalper', 'day trader', 'swing trader', 'position trader', 'investor',
  'algorithmic trader', 'SMC / ICT', 'technical analysis', 'fundamental analysis',
  'momentum', 'mean reversion', 'trend following',
] as const

export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number]

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
