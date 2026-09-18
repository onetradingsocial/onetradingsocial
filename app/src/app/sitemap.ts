import type { MetadataRoute } from 'next'
import { createServiceClient } from '@/lib/supabase/service'
import { APP_ORIGIN, PUBLIC_STATIC_PATHS } from '@/lib/seo'
import { isReservedProfileSegment, validateUsername } from '@/lib/username'

// SEO audit 2026-09-18, finding 1. Lists only public, indexable URLs.
//
// Regenerated at most hourly rather than frozen at build time, so a profile
// that goes public (or private) shows up within the hour, not at next deploy.
export const revalidate = 3600

// A sitemap file is capped at 50,000 URLs. Far above today's numbers; the loop
// stops there rather than emitting an invalid file.
const MAX_PROFILES = 49_000
const PAGE = 1000

/**
 * Indexable profiles: is_public AND onboarding_completed AND NOT is_internal —
 * the same three conditions as `[username]/page.tsx` generateMetadata, which is
 * what decides index vs noindex on the page itself.
 *
 * Service client, for the same reason and in the same shape as
 * lib/server/recommend.ts and lib/server/compare.ts: migration 0047 revokes
 * SELECT on `is_internal` from anon and authenticated, and Postgres needs that
 * privilege for a column named in a WHERE clause, so an anon-client
 * `.eq('is_internal', false)` fails with 42501. The projection is two columns
 * that are already public (username, updated_at), and the two RLS conditions
 * are restated explicitly, so this returns nothing the anon profile read would
 * not — minus the seed and staff accounts.
 *
 * Fails CLOSED: any read error drops profiles from the sitemap for this cycle
 * rather than risking an unfiltered list.
 */
async function publicProfiles(): Promise<MetadataRoute.Sitemap> {
  const out: MetadataRoute.Sitemap = []
  try {
    const svc = createServiceClient()
    for (let from = 0; from < MAX_PROFILES; from += PAGE) {
      const { data, error } = await svc
        .from('profiles')
        .select('username, updated_at')
        .eq('is_public', true)
        .eq('onboarding_completed', true)
        .eq('is_internal', false)
        .order('username')
        .range(from, from + PAGE - 1)
      if (error || !data) return []
      for (const p of data) {
        const u = p.username as string
        // Only names that are a clean URL segment. A name stored through the
        // unvalidated signup-trigger path (padding, dots, odd characters) is
        // still viewable; it is just not advertised.
        const v = validateUsername(u)
        if (!v.ok || v.name !== u || isReservedProfileSegment(u)) continue
        out.push({
          url: `${APP_ORIGIN}/${encodeURIComponent(u)}`,
          ...(p.updated_at ? { lastModified: new Date(p.updated_at as string) } : {}),
          changeFrequency: 'weekly',
          priority: 0.6,
        })
      }
      if (data.length < PAGE) break
    }
  } catch {
    return []
  }
  return out
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages: MetadataRoute.Sitemap = PUBLIC_STATIC_PATHS.map((path) => ({
    url: `${APP_ORIGIN}${path}`,
    changeFrequency: 'monthly',
    priority: 0.5,
  }))
  return [...pages, ...(await publicProfiles())]
}
