import type { MetadataRoute } from 'next'
import { ALLOWED_UNDER_PRIVATE, APP_ORIGIN, disallowRules } from '@/lib/seo'

// SEO audit 2026-09-18, finding 1. Before this file existed the `/[username]`
// catch-all answered /robots.txt with a 200 HTML page. A static metadata route
// takes precedence over a dynamic segment, so this now wins.
//
// Private areas are disallowed with anchored rules (see disallowRules) so they
// cannot shadow a profile whose username merely starts with the same letters.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', ...ALLOWED_UNDER_PRIVATE],
      disallow: disallowRules(),
    },
    sitemap: `${APP_ORIGIN}/sitemap.xml`,
    host: APP_ORIGIN,
  }
}
