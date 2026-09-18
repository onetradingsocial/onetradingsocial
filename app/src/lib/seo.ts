// Crawl policy for the product app (SEO audit 2026-09-18, findings 1 and 3).
//
// Pure data and pure functions, so robots.ts and sitemap.ts stay thin and the
// rules are unit-testable without a request scope.

/** The one origin search engines should ever be told about. Deliberately NOT
 *  read from NEXT_PUBLIC_SITE_URL: a preview or localhost build that pointed
 *  its sitemap and canonical base at itself would be advertising a host that
 *  must never be indexed. */
export const APP_ORIGIN = 'https://app.tradingsocial.io'

/**
 * Top-level routes that are private, gated or purely mechanical. Derived from
 * `app/src/app`: every directory there that is not a public page.
 *
 *   admin                 staff tools (requireAdmin → 404)
 *   api                   route handlers (the OG image endpoint is re-allowed)
 *   auth                  callback / confirm / reset / signout handlers
 *   r                     referral redirect — each hit writes referral_clicks
 *   settings, messages, journal, achievements, referrals, feature-board,
 *   leaderboard, learn    login-gated app pages
 *   onboarding, welcome, select-plan   signup funnel (middleware-gated)
 *
 * NOT listed, on purpose: login, signup, forgot-password, check-email and
 * reset-password. They carry `noindex, follow`, and a crawler that is disallowed
 * from fetching a page never sees its noindex.
 */
export const PRIVATE_ROUTES = [
  'admin', 'api', 'auth', 'r',
  'settings', 'messages', 'journal', 'achievements', 'referrals',
  'feature-board', 'leaderboard', 'learn',
  'onboarding', 'welcome', 'select-plan',
] as const

/** Paths inside a disallowed route that must stay fetchable. Twitterbot obeys
 *  robots.txt, and the profile share card is served from here. */
export const ALLOWED_UNDER_PRIVATE = ['/api/og/'] as const

/**
 * robots.txt matching is by PREFIX, and every one of these routes sits in the
 * same URL namespace as `/[username]`. A bare `Disallow: /journal` would also
 * block the profile `/journalist`, and `/r` would block every username starting
 * with r. So each route is expressed as three anchored rules — the exact path
 * (`$`, supported by Google and Bing), its subtree, and its query-string form —
 * none of which can match a different first segment.
 */
export function disallowRules(routes: readonly string[] = PRIVATE_ROUTES): string[] {
  return routes.flatMap((r) => [`/${r}$`, `/${r}/`, `/${r}?`])
}

/** Public, indexable, non-profile pages. `/for/*` is excluded: those pages
 *  canonicalise to www.tradingsocial.io (see for/[audience]/page.tsx), and a
 *  sitemap must not list a URL whose canonical is elsewhere. */
export const PUBLIC_STATIC_PATHS = ['/changelog', '/demo', '/verification'] as const
