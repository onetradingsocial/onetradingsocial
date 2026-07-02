import 'server-only'
import { unstable_cache } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import { flagsFromRows, type FlagMap, type FlagRow } from '@/lib/feature-flags'

export const FLAGS_TAG = 'feature-flags'

/** Cached per-tier flag overrides. Fails open to {} so canFlag falls back to
 *  the static FEATURE_MIN_TIER defaults on any error. Service client: flags
 *  must resolve for logged-out renders (e.g. AppNav) too. */
export const getFeatureFlags = unstable_cache(
  async (): Promise<FlagMap> => {
    try {
      const svc = createServiceClient()
      const { data, error } = await svc
        .from('feature_flags').select('feature, free, trader, pro')
      if (error || !data) return {}
      return flagsFromRows(data as FlagRow[])
    } catch {
      return {}
    }
  },
  ['feature-flags'],
  { revalidate: 60, tags: [FLAGS_TAG] },
)
