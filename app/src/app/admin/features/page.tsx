import { requireAdmin } from '@/lib/server/admin'
import { createServiceClient } from '@/lib/supabase/service'
import { FEATURE_MIN_TIER, type Feature } from '@/lib/entitlements'
import { FEATURE_KEYS, defaultMatrix, flagsFromRows, type FlagRow } from '@/lib/feature-flags'
import { FlagMatrix, type FlagGroup, type FlagRowView } from '../_components/FlagMatrix'

export const dynamic = 'force-dynamic'

/** Features with a live canFlag() call site today. Toggles on other rows
 *  take effect automatically once their feature gets a gate. */
const WIRED = new Set<string>([
  'journal_unlimited', 'advanced_journal', 'advanced_stats', 'pro_badge', 'custom_badge',
  'creator_profile', 'saved_traders', 'weekly_review', 'strategy_breakdown',
  'strategy_tracking', 'mistake_tagging', 'risk_tracking', 'private_notes', 'custom_templates',
  'monthly_report', 'advanced_leaderboard_filters', 'leaderboard_placement', 'xp_boosts',
  'export_journal', 'advanced_reporting', 'mt5_import', 'mt5_autosync',
])

/** Rows that ARE enforced, just not through feature_flags (course min_tier). */
const GATED_ELSEWHERE: Record<string, string> = {
  learning_intermediate: 'gated via course min_tier',
  premium_courses: 'gated via course min_tier',
}

/** Mirrors the pricing-page sections so admins can cross-check quickly. */
const GROUPS: { title: string; keys: Feature[] }[] = [
  { title: 'Profile & Community', keys: ['pro_badge', 'custom_badge', 'creator_profile', 'saved_traders'] },
  { title: 'Trading Journal', keys: ['journal_unlimited', 'advanced_journal', 'strategy_tracking', 'mistake_tagging', 'risk_tracking', 'private_notes', 'custom_templates', 'export_journal', 'mt5_import', 'mt5_autosync'] },
  { title: 'Analytics & Reports', keys: ['advanced_stats', 'weekly_review', 'strategy_breakdown', 'advanced_reporting', 'monthly_report', 'ai_insights'] },
  { title: 'Leaderboards & Competitions', keys: ['advanced_leaderboard_filters', 'leaderboard_placement', 'premium_challenges'] },
  { title: 'Learning Hub', keys: ['learning_intermediate', 'premium_courses', 'xp_boosts'] },
  { title: 'Support & Access', keys: ['priority_support', 'early_access'] },
]

export default async function AdminFeaturesPage() {
  await requireAdmin()
  const svc = createServiceClient()
  const { data } = await svc.from('feature_flags').select('feature, free, trader, pro')
  const flags = flagsFromRows((data ?? []) as FlagRow[])

  const toRow = (key: Feature): FlagRowView => ({
    key,
    label: key.replace(/_/g, ' '),
    defaultTier: FEATURE_MIN_TIER[key],
    values: flags[key] ?? defaultMatrix(key),
    defaults: defaultMatrix(key),
    wired: WIRED.has(key),
    note: GATED_ELSEWHERE[key] ?? null,
  })

  const grouped = new Set(GROUPS.flatMap((g) => g.keys as string[]))
  const leftovers = FEATURE_KEYS.filter((k) => !grouped.has(k))
  const groups: FlagGroup[] = [
    ...GROUPS.map((g) => ({ title: g.title, rows: g.keys.map(toRow) })),
    ...(leftovers.length ? [{ title: 'Other', rows: leftovers.map(toRow) }] : []),
  ]

  const wiredCount = FEATURE_KEYS.filter((k) => WIRED.has(k)).length

  return (
    <section>
      <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <h2 className="ts-h2">Feature flags</h2>
        <span className="ts-chip2">{wiredCount} of {FEATURE_KEYS.length} wired</span>
      </div>
      <p className="faint mt-1">
        Per-tier access, grouped to mirror the pricing table. Unchecked = that tier sees the upgrade prompt.
        Changes reach users within ~60s (cache). Reset restores the code default.
      </p>
      <FlagMatrix groups={groups} />
    </section>
  )
}
