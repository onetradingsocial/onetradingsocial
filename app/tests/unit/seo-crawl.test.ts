import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import robots from '@/app/robots'
import sitemap from '@/app/sitemap'
import { APP_ORIGIN, NOINDEX_GATED_ROUTES, PRIVATE_ROUTES } from '@/lib/seo'
import { isReservedProfileSegment } from '@/lib/username'

/**
 * SEO audit 2026-09-18, findings 1, 3, 4 and 5.
 *
 * Before this change the `/[username]` catch-all answered /robots.txt and
 * /sitemap.xml with a 200 HTML page, eight login-gated pages answered crawlers
 * with a 200 and a meta-refresh and no noindex, and seed accounts were
 * indexable as "verified trading track record" profiles. None of that broke a
 * build or a test. These do.
 *
 * Runtime checks where the module is pure (robots, sitemap with a mocked
 * service client); source checks where importing a Server Component page would
 * drag in `next/headers` and a request scope — the admin-gate.test.ts approach.
 */

const APP_DIR = join(process.cwd(), 'src', 'app')
const read = (rel: string) => readFileSync(join(APP_DIR, rel), 'utf8')

// --------------------------------------------------------------------------
// A small robots.txt matcher with Google's semantics: longest matching rule
// wins, Allow wins a tie, `*` is a wildcard and a trailing `$` anchors the end.
// --------------------------------------------------------------------------
function ruleMatches(rule: string, path: string): boolean {
  const anchored = rule.endsWith('$')
  const body = (anchored ? rule.slice(0, -1) : rule)
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
  return new RegExp(`^${body}${anchored ? '$' : ''}`).test(path)
}

function allowed(path: string, allow: string[], disallow: string[]): boolean {
  const best = (rules: string[]) =>
    Math.max(-1, ...rules.filter((r) => ruleMatches(r, path)).map((r) => r.length))
  const a = best(allow)
  const d = best(disallow)
  return d < 0 || a >= d
}

const asArray = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v])

describe('robots.txt (finding 1)', () => {
  const r = robots()
  const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules
  const allow = asArray(rule.allow)
  const disallow = asArray(rule.disallow)

  it('points at the app sitemap on the production origin', () => {
    expect(r.sitemap).toBe('https://app.tradingsocial.io/sitemap.xml')
    expect(APP_ORIGIN).toBe('https://app.tradingsocial.io')
  })

  it.each([
    '/settings', '/settings/billing', '/admin', '/admin/users/123',
    '/api/stats', '/api/track', '/auth/callback', '/auth/confirm?token=x',
    '/onboarding', '/welcome', '/select-plan', '/r/ABC123',
  ])('disallows the private path %s', (path) => {
    expect(allowed(path, allow, disallow)).toBe(false)
  })

  it.each([
    '/', '/changelog', '/demo', '/verification', '/for/prop-firm',
    '/mateorivera', '/api/og/profile/mateorivera',
    // Auth pages carry noindex,follow. A crawler barred from fetching them
    // would never read that noindex.
    '/login', '/signup', '/forgot-password', '/check-email', '/reset-password',
    // Gated pages answer logged-out crawlers with a 200 + noindex,nofollow.
    // Same reasoning: blocking them would hide the noindex.
    '/messages', '/journal', '/journal/report', '/achievements', '/referrals',
    '/feature-board', '/leaderboard', '/leaderboard?period=week', '/learn',
  ])('allows the fetchable path %s', (path) => {
    expect(allowed(path, allow, disallow)).toBe(true)
  })

  it.each([
    // Every one of these is a legal username that shares a prefix with a
    // private route. A bare `Disallow: /journal` would have blocked them all.
    '/journalist', '/learner_1', '/rachel', '/admins', '/settingsguy',
    '/apistrader', '/authentic', '/messages_x', '/welcomebot', '/referrals2',
  ])('does not shadow the profile %s', (path) => {
    expect(allowed(path, allow, disallow)).toBe(true)
  })

  it('covers every top-level route that is not a public page', () => {
    // Derived from the filesystem so a new private route cannot ship without
    // a decision here. Anything not public must be disallowed or noindexed.
    const PUBLIC = new Set([
      '[username]', 'changelog', 'demo', 'verification', 'for',
      'login', 'signup', 'forgot-password', 'check-email', 'reset-password',
    ])
    // A directory is a route if anything under it is a page or route handler;
    // `feed/`, `hooks/`, `_components/` and `actions/` are code, not URLs.
    const routable = (dir: string): boolean =>
      readdirSync(dir).some((e) => {
        const full = join(dir, e)
        return statSync(full).isDirectory() ? routable(full) : e === 'page.tsx' || e === 'route.ts'
      })
    const dirs = readdirSync(APP_DIR).filter((e) => statSync(join(APP_DIR, e)).isDirectory() && routable(join(APP_DIR, e)))
    expect(dirs.length).toBeGreaterThan(20)
    const uncovered = dirs.filter(
      (d) =>
        !PUBLIC.has(d) &&
        !(PRIVATE_ROUTES as readonly string[]).includes(d) &&
        !(NOINDEX_GATED_ROUTES as readonly string[]).includes(d),
    )
    expect(uncovered).toEqual([])
  })
})

// --------------------------------------------------------------------------
// sitemap.xml — runtime, against a fake service client that applies the
// filters the code actually sends. If a filter is dropped, the row it was
// meant to exclude shows up in the output.
// --------------------------------------------------------------------------
type Row = { username: string; updated_at: string | null; is_public: boolean; onboarding_completed: boolean; is_internal: boolean }
let ROWS: Row[] = []
let failWith: unknown = null

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      expect(table).toBe('profiles')
      const filters: [string, unknown][] = []
      let range: [number, number] = [0, Number.MAX_SAFE_INTEGER]
      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => { filters.push([col, val]); return q },
        order: () => q,
        range: (a: number, b: number) => { range = [a, b]; return q },
        then: (resolve: (v: unknown) => void) => {
          if (failWith) return resolve({ data: null, error: failWith })
          const data = ROWS
            .filter((r) => filters.every(([c, v]) => (r as Record<string, unknown>)[c] === v))
            .slice(range[0], range[1] + 1)
            .map(({ username, updated_at }) => ({ username, updated_at }))
          resolve({ data, error: null })
        },
      }
      return q
    },
  }),
}))

const row = (username: string, over: Partial<Row> = {}): Row => ({
  username, updated_at: '2026-09-01T00:00:00Z', is_public: true, onboarding_completed: true, is_internal: false, ...over,
})

describe('sitemap.xml (findings 1 and 4)', () => {
  beforeEach(() => { ROWS = []; failWith = null })

  it('lists public, onboarded, non-internal profiles and nothing else', async () => {
    ROWS = [
      row('alex_07'),
      row('mateorivera', { is_internal: true }),
      row('private_pat', { is_public: false }),
      row('halfway_hal', { onboarding_completed: false }),
      row(' padded'),            // unvalidated trigger path: viewable, not advertised
      row('llms.txt'),           // file-shaped
      row('settings'),           // reserved
    ]
    const urls = (await sitemap()).map((e) => e.url)
    expect(urls).toContain('https://app.tradingsocial.io/alex_07')
    expect(urls.filter((u) => /\/(mateorivera|private_pat|halfway_hal|llms\.txt|settings|%20padded)$/.test(u))).toEqual([])
  })

  it('includes the public static pages and never /for/*, which canonicalise to www', async () => {
    const urls = (await sitemap()).map((e) => e.url)
    expect(urls).toEqual(expect.arrayContaining([
      'https://app.tradingsocial.io/changelog',
      'https://app.tradingsocial.io/demo',
      'https://app.tradingsocial.io/verification',
    ]))
    expect(urls.some((u) => u.includes('/for/'))).toBe(false)
    expect(read('for/[audience]/page.tsx')).toMatch(/canonical: `https:\/\/www\.tradingsocial\.io\/for\//)
  })

  it('lists no private or auth path', async () => {
    const paths = (await sitemap()).map((e) => new URL(e.url).pathname.split('/')[1])
    for (const p of [...PRIVATE_ROUTES, ...NOINDEX_GATED_ROUTES, 'login', 'signup', 'forgot-password', 'check-email', 'reset-password', '']) {
      expect(paths).not.toContain(p)
    }
  })

  it('fails closed: a read error drops profiles rather than listing them unfiltered', async () => {
    ROWS = [row('alex_07'), row('mateorivera', { is_internal: true })]
    failWith = { message: 'boom' }
    const urls = (await sitemap()).map((e) => e.url)
    expect(urls.some((u) => /alex_07|mateorivera/.test(u))).toBe(false)
  })

  it('pages through more than one PostgREST page', async () => {
    ROWS = Array.from({ length: 1500 }, (_, i) => row(`trader_${String(i).padStart(4, '0')}`))
    const profiles = (await sitemap()).filter((e) => e.url.includes('/trader_'))
    expect(profiles).toHaveLength(1500)
  })
})

// --------------------------------------------------------------------------
// noindex on auth and gated pages (finding 3) — source checks.
// --------------------------------------------------------------------------
function walkPages(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir)) {
    const full = join(dir, e)
    if (statSync(full).isDirectory()) out.push(...walkPages(full))
    else if (e === 'page.tsx') out.push(relative(APP_DIR, full).split(sep).join('/'))
  }
  return out
}

/** The object literal of `export const metadata`, or null. */
function metadataBlock(src: string): string | null {
  const m = src.match(/export const metadata: Metadata = \{[\s\S]*?\n\}/)
  return m ? m[0] : null
}

const NOINDEX_NOFOLLOW = /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/
const NOINDEX_FOLLOW = /robots:\s*\{\s*index:\s*false,\s*follow:\s*true\s*\}/

const AUTH_PAGES = ['login', 'signup', 'forgot-password', 'check-email', 'reset-password']
const GATED_PAGES = [
  'leaderboard', 'feature-board', 'learn', 'messages', 'referrals', 'achievements',
  'journal', 'journal/report',
]

describe('noindex where it belongs (finding 3)', () => {
  it('every gated route left crawlable in robots.txt exports noindex', () => {
    // NOINDEX_GATED_ROUTES are deliberately not disallowed, so the noindex is
    // the only thing keeping them out of the index.
    for (const r of NOINDEX_GATED_ROUTES) expect(GATED_PAGES).toContain(r)
  })

  it.each(AUTH_PAGES)('/%s exports noindex, follow', (route) => {
    const block = metadataBlock(read(`${route}/page.tsx`))
    expect(block).not.toBeNull()
    expect(block).toMatch(NOINDEX_FOLLOW)
    expect(block).toMatch(/title: '[^']+ — TradingSocial'/)
  })

  it.each(GATED_PAGES)('/%s exports noindex, nofollow', (route) => {
    const block = metadataBlock(read(`${route}/page.tsx`))
    expect(block).not.toBeNull()
    expect(block).toMatch(NOINDEX_NOFOLLOW)
    expect(block).toMatch(/title: '[^']+ — TradingSocial'/)
  })

  it('every page that redirects a logged-out visitor to /login exports noindex', () => {
    // Derived, not listed: `redirect('/login')` inside a page runs after the
    // shell has streamed, so the crawler gets a 200 and a meta-refresh. The
    // page must say noindex itself. A new gated page trips this on day one.
    const pages = walkPages(APP_DIR)
    const gated = pages.filter((p) => /redirect\('\/login'\)/.test(read(p)))
    expect(gated.length).toBeGreaterThanOrEqual(GATED_PAGES.length)
    const missing = gated.filter((p) => {
      const block = metadataBlock(read(p))
      return !block || !NOINDEX_NOFOLLOW.test(block)
    })
    expect(missing).toEqual([])
  })

  it('none of these pages is a Client Component, where metadata is ignored', () => {
    for (const r of [...AUTH_PAGES, ...GATED_PAGES]) {
      expect(read(`${r}/page.tsx`)).not.toMatch(/^\s*['"]use client['"]/m)
    }
  })

  it('the root layout sets metadataBase to the production origin', () => {
    const layout = read('layout.tsx')
    expect(layout).toMatch(/metadataBase: new URL\(APP_ORIGIN\)/)
  })
})

// --------------------------------------------------------------------------
// Profile page (findings 1, 4, 5) — source checks.
// --------------------------------------------------------------------------
describe('public profile page', () => {
  const SRC = read('[username]/page.tsx')
  const meta = SRC.slice(SRC.indexOf('export async function generateMetadata'), SRC.indexOf('export default async function ProfilePage'))

  it('generateMetadata checks is_internal and noindexes internal accounts', () => {
    expect(meta).toMatch(/isInternalProfile\(p\.id\)/)
    expect(meta).toMatch(/if \(await isInternalProfile\(p\.id\)\) meta\.robots = \{ index: false, follow: false \}/)
  })

  it('reads is_internal through the service client (0047 revokes it from client roles) and fails closed', () => {
    const fn = meta.slice(meta.indexOf('async function isInternalProfile'))
    expect(fn).toMatch(/createServiceClient\(\)\s*\.from\('profiles'\)\.select\('is_internal'\)\.eq\('id', id\)/)
    expect(fn).toMatch(/if \(error \|\| !data\) return true/)
    expect(fn).toMatch(/catch \{\s*return true/)
  })

  it('still gates index on is_public and onboarding_completed', () => {
    expect(meta).toMatch(/!p \|\| !p\.is_public \|\| !p\.onboarding_completed/)
  })

  it('refuses reserved and file-shaped segments before touching the database', () => {
    expect(SRC).toMatch(/if \(isReservedProfileSegment\(username\)\) notFound\(\)/)
    expect(meta).toMatch(/if \(isReservedProfileSegment\(username\)\) return/)
  })

  it('renders the trader name as the page h1', () => {
    expect(SRC).toMatch(/<h1 className="pf-name-text">\{name\}<\/h1>/)
    expect(SRC.match(/<h1[\s>]/g)).toHaveLength(1)
    expect(read('[username]/profile.css')).toMatch(/\.pf-name \.pf-name-text \{ font: inherit; letter-spacing: inherit;/)
  })
})

describe('isReservedProfileSegment', () => {
  it.each(['robots.txt', 'sitemap.xml', 'llms.txt', 'LLMS.TXT', 'ads.txt', 'favicon.ico', 'settings', 'Admin'])(
    'rejects %s',
    (s) => { expect(isReservedProfileSegment(s)).toBe(true) },
  )

  it.each(['alex_07', 'mateorivera', 'journalist', 'user_1a2b3c4d'])('accepts %s', (s) => {
    expect(isReservedProfileSegment(s)).toBe(false)
  })
})

// --------------------------------------------------------------------------
// Heading order (finding 5).
// --------------------------------------------------------------------------
describe('heading order', () => {
  it('the /for landing cards follow the h1 with h2, not h3', () => {
    const src = read('for/[audience]/page.tsx')
    expect(src).not.toMatch(/<h3[\s>]/)
    expect(src).toMatch(/<h2 style=\{\{ fontFamily: 'var\(--font-display\)', fontSize: 17, marginBottom: 6 \}\}>\{p\.title\}<\/h2>/)
  })

  it('AuthShell puts no heading ahead of the form h1', () => {
    const src = read('_components/AuthShell.tsx')
    const aside = src.slice(src.indexOf('<aside'), src.indexOf('</aside>'))
    expect(aside).not.toMatch(/<h[1-6][\s>]/)
    expect(aside).toMatch(/<div className="fl-aside-title">/)
    const css = read('globals.css')
    expect(css).toMatch(/\.fl-aside \.fl-aside-title \{ font-family: var\(--display\); font-size: 30px;/)
    expect(css).not.toMatch(/\.fl-aside h2/)
  })
})
