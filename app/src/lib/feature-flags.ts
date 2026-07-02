import { can, FEATURE_MIN_TIER, type Feature, type Tier } from '@/lib/entitlements'

export type FlagValues = { free: boolean; trader: boolean; pro: boolean }
export type FlagRow = { feature: string } & FlagValues
export type FlagMap = Partial<Record<Feature, FlagValues>>

export const FEATURE_KEYS = Object.keys(FEATURE_MIN_TIER) as Feature[]

export function isFeature(key: string): key is Feature {
  return (FEATURE_KEYS as string[]).includes(key)
}

export function flagsFromRows(rows: FlagRow[]): FlagMap {
  const map: FlagMap = {}
  for (const r of rows) {
    if (isFeature(r.feature)) map[r.feature] = { free: r.free, trader: r.trader, pro: r.pro }
  }
  return map
}

/** DB override if present, else the static FEATURE_MIN_TIER default. */
export function canFlag(flags: FlagMap, tier: Tier, feature: Feature): boolean {
  const row = flags[feature]
  return row ? row[tier] : can(tier, feature)
}

/** The static default matrix for a feature — what "reset" restores. */
export function defaultMatrix(feature: Feature): FlagValues {
  return {
    free: can('free', feature),
    trader: can('trader', feature),
    pro: can('pro', feature),
  }
}
