import { requireAdmin } from '@/lib/server/admin'
import { createServiceClient } from '@/lib/supabase/service'
import { FEATURE_MIN_TIER } from '@/lib/entitlements'
import { FEATURE_KEYS, defaultMatrix, flagsFromRows, type FlagRow } from '@/lib/feature-flags'
import { FlagMatrix, type FlagRowView } from '../_components/FlagMatrix'

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

export default async function AdminFeaturesPage() {
  await requireAdmin()
  const svc = createServiceClient()
  const { data } = await svc.from('feature_flags').select('feature, free, trader, pro')
  const flags = flagsFromRows((data ?? []) as FlagRow[])

  const rows: FlagRowView[] = FEATURE_KEYS.map((key) => ({
    key,
    label: key.replace(/_/g, ' '),
    defaultTier: FEATURE_MIN_TIER[key],
    values: flags[key] ?? defaultMatrix(key),
    defaults: defaultMatrix(key),
    wired: WIRED.has(key),
  }))

  return (
    <section>
      <h2 className="ts-h2">Feature flags</h2>
      <p className="faint mt-1">
        Per-tier access. Unchecked = that tier sees the upgrade prompt.
        Changes reach users within ~60s (cache). Reset restores the code default.
        Rows marked &ldquo;not wired yet&rdquo; have no live gate in the app; the toggle takes effect once the feature ships.
      </p>
      <div className="ts-card mt-4">
        <FlagMatrix rows={rows} />
      </div>
    </section>
  )
}
