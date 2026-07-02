import { requireAdmin } from '@/lib/server/admin'
import { createServiceClient } from '@/lib/supabase/service'
import { FEATURE_MIN_TIER } from '@/lib/entitlements'
import { FEATURE_KEYS, defaultMatrix, flagsFromRows, type FlagRow } from '@/lib/feature-flags'
import { FlagMatrix, type FlagRowView } from '../_components/FlagMatrix'

export const dynamic = 'force-dynamic'

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
  }))

  return (
    <section>
      <h2 className="ts-h2">Feature flags</h2>
      <p className="faint mt-1">
        Per-tier access. Unchecked = that tier sees the upgrade prompt.
        Changes reach users within ~60s (cache). Reset restores the code default.
      </p>
      <div className="ts-card mt-4">
        <FlagMatrix rows={rows} />
      </div>
    </section>
  )
}
