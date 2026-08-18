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

/**
 * Who may appear on a public leaderboard, as a pure function of the three
 * inputs the server has already gathered (audit item 15, F6).
 *
 * Lives here, away from the Supabase reads, so the decision itself is testable
 * without a database. `lib/server/entitlements.ts#leaderboardEligibleIds` is a
 * thin wrapper that fetches `tiers` (getTierMap), `flags` (getFeatureFlags)
 * and `internal` (profiles.is_internal, service role) and calls this.
 *
 * Both rules fail CLOSED:
 *   - a tier that is absent from `tiers` is UNKNOWN, not free, and does not
 *     rank. getTierMap omits a user on any read error, so treating unknown as
 *     eligible turned one transient error into a public board of seeded
 *     personas;
 *   - a user in `internal` never ranks, whatever their tier.
 */
export function boardEligibleIds(
  ids: string[],
  tiers: Map<string, Tier>,
  flags: FlagMap,
  internal: ReadonlySet<string>,
): string[] {
  return [...new Set(ids)].filter((id) => {
    if (internal.has(id)) return false
    const tier = tiers.get(id)
    return tier !== undefined && canFlag(flags, tier, 'leaderboard_ranking')
  })
}

/** The static default matrix for a feature — what "reset" restores. */
export function defaultMatrix(feature: Feature): FlagValues {
  return {
    free: can('free', feature),
    trader: can('trader', feature),
    pro: can('pro', feature),
  }
}
