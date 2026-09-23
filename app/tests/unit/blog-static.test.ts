// app/tests/unit/blog-static.test.ts
//
// SEO audit 2026-09-18, gap 1. Every blog post used to be the same shell,
// blog-post.html, filled in by JavaScript after load. Without JavaScript a
// crawler saw ten copies of one page: post 1's title and description, an empty
// <h1>, no body, and a canonical of /blog-post, which itself redirected to
// /blog. Nothing failed: the pages looked right in a browser.
//
// Posts are now pre-rendered by scripts/build-blog.mjs. These tests read the
// shipped HTML the way a crawler does (no JavaScript) and fail if the output is
// stale or if a post collapses back into a shared shell.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

// repo root is three levels up from app/tests/unit
const ROOT = join(__dirname, '..', '..', '..')
// CRLF normalised: a Windows checkout (core.autocrlf) converts the generated
// files, and the body comparison below would fail on line endings alone.
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')

type Post = {
  slug: string
  title: string
  excerpt: string
  body: string
  published_date: string
  updated_date?: string
}
const allPosts: Post[] = JSON.parse(read('data/posts.json'))
/** Today in UTC, matching scripts/build-blog.mjs — a string compare, no zones. */
const TODAY = new Date().toISOString().slice(0, 10)
/** A post dated in the future is scheduled: it is in the data file and on no
 *  page. The workflow publishes it on the day (see scheduled posts, below). */
const posts = allPosts.filter((p) => p.published_date <= TODAY)
const scheduled = allPosts.filter((p) => p.published_date > TODAY)
const SITE = 'https://www.tradingsocial.io'

/** Minimal entity decoding — enough to compare escaped HTML with posts.json. */
const decode = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

const one = (html: string, re: RegExp, what: string) => {
  const all = [...html.matchAll(new RegExp(re.source, 'g'))]
  expect(all.length, `expected exactly one ${what}`).toBe(1)
  return decode(all[0][1])
}

describe('pre-rendered blog posts', () => {
  it('blog/ matches data/posts.json and the template (run scripts/build-blog.mjs)', () => {
    // --check exits non-zero and names the stale files when the output drifts.
    // It covers blog.html, llms.txt and sitemap.xml too.
    expect(() =>
      execFileSync(process.execPath, [join(ROOT, 'scripts', 'build-blog.mjs'), '--check'], {
        stdio: 'pipe',
      }),
    ).not.toThrow()
  })

  it.each(posts.map((p) => [p.slug, p] as const))('%s is a complete page without JavaScript', (slug, post) => {
    const html = read(`blog/${slug}.html`)
    const url = `${SITE}/blog/${slug}`

    expect(one(html, /<title>([^<]*)<\/title>/, '<title>')).toBe(`${post.title} — TradingSocial`)
    expect(one(html, /<meta name="description" content="([^"]*)">/, 'meta description')).toBe(post.excerpt)
    expect(one(html, /<link rel="canonical" href="([^"]*)">/, 'canonical')).toBe(url)
    expect(one(html, /<meta property="og:url" content="([^"]*)">/, 'og:url')).toBe(url)
    expect(one(html, /<h1[^>]*>([^<]*)<\/h1>/, '<h1>')).toBe(post.title)

    // The body is in the HTML, not fetched.
    expect(html).toContain(post.body)
    expect(html).not.toContain('posts.json')
    expect(html).not.toMatch(/\{\{/)

    // Two JSON-LD blocks: the article itself, and its place under /blog.
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g)].map((m) =>
      JSON.parse(m[1]),
    )
    const ofType = (t: string) => blocks.filter((b) => b['@type'] === t)
    expect(ofType('BlogPosting'), 'expected exactly one BlogPosting block').toHaveLength(1)
    const ld = ofType('BlogPosting')[0]
    expect(ld.headline).toBe(post.title)
    expect(ld.mainEntityOfPage['@id']).toBe(url)
    expect(ofType('BreadcrumbList'), 'expected exactly one BreadcrumbList block').toHaveLength(1)
    const trail = ofType('BreadcrumbList')[0].itemListElement
    expect(trail.map((i: { item: string }) => i.item)).toEqual([`${SITE}/`, `${SITE}/blog`, url])
    expect(trail.at(-1).name).toBe(post.title)
  })

  it('no two posts share a title, description or canonical', () => {
    for (const re of [/<title>([^<]*)<\/title>/, /<meta name="description" content="([^"]*)">/, /<link rel="canonical" href="([^"]*)">/]) {
      const values = posts.map((p) => read(`blog/${p.slug}.html`).match(re)?.[1])
      expect(new Set(values).size).toBe(posts.length)
    }
  })

  it('every post links to other posts with plain hrefs', () => {
    const slugs = new Set(posts.map((p) => p.slug))
    for (const p of posts) {
      const links = [...read(`blog/${p.slug}.html`).matchAll(/href="\/blog\/([^"]+)"/g)].map((m) => m[1])
      expect(links.length, `${p.slug} links to no other post`).toBeGreaterThan(0)
      for (const l of links) expect(slugs.has(l), `${p.slug} links to missing /blog/${l}`).toBe(true)
    }
  })

  it('the old shared shell is gone and cannot be served', () => {
    // A rewrite to a shared page is what made every URL the same document.
    // Unknown slugs should now 404 instead of rendering post 1's metadata.
    expect(existsSync(join(ROOT, 'blog-post.html'))).toBe(false)
    const vercel = JSON.parse(read('vercel.json'))
    expect(vercel.rewrites ?? []).not.toContainEqual(expect.objectContaining({ destination: '/blog-post' }))
    expect(vercel.redirects).toContainEqual({ source: '/blog-post', destination: '/blog', permanent: true })
    expect(read('.vercelignore')).toMatch(/^templates\/$/m)
  })

  it('the sitemap lists exactly the generated posts, dated from posts.json', () => {
    const sitemap = read('sitemap.xml')
    const listed = [...sitemap.matchAll(/<loc>https:\/\/www\.tradingsocial\.io\/blog\/([^<]+)<\/loc>/g)].map((m) => m[1])
    const generated = readdirSync(join(ROOT, 'blog')).map((f) => f.replace(/\.html$/, ''))
    expect(listed.sort()).toEqual(generated.sort())
    for (const p of posts) {
      const entry = sitemap.match(new RegExp(`<loc>${SITE}/blog/${p.slug}</loc>\\s*<lastmod>([^<]+)</lastmod>`))
      expect(entry?.[1], `${p.slug} lastmod`).toBe(p.updated_date || p.published_date)
    }
  })
})

// SEO audit 2026-09-18: blog.html built its card list in the browser from
// /data/posts.json, so the index a crawler read linked to no post at all. The
// featured post and the grid are now rendered into the page by the same script.
describe('the blog index without JavaScript', () => {
  const html = read('blog.html')
  // What a crawler sees: the markup, not what the page's scripts would add.
  const markup = html.replace(/<script\b[\s\S]*?<\/script>/g, '')

  it.each(posts.map((p) => [p.slug] as const))('links to /blog/%s with a plain href', (slug) => {
    expect(markup).toContain(`href="/blog/${slug}"`)
  })

  it('names every post in a heading, the featured one included', () => {
    const headings = [...markup.matchAll(/<h[23]\b[^>]*>(?:<a [^>]*>)?([^<]*)/g)].map((m) => decode(m[1]))
    for (const p of posts) expect(headings, p.slug).toContain(p.title)
  })

  it('counts what it shows, and every card can be filtered to', () => {
    const cards = [...markup.matchAll(/<article class="pcard-blog[^"]*" data-cat="([^"]+)"/g)].map((m) => m[1])
    expect(cards).toHaveLength(posts.length - 1) // the featured post sits above the grid
    expect(markup).toContain(`Showing ${cards.length} articles`)
    const chips = new Set([...markup.matchAll(/class="fchip[^"]*" data-cat="([^"]+)"/g)].map((m) => m[1]))
    for (const c of cards) expect(chips.has(c), `no filter chip for data-cat="${c}"`).toBe(true)
  })

  it('no longer builds the cards in the browser', () => {
    // The script may still read posts.json for the hero's latest-post date
    // (copy-claims.test.ts), but it must not replace the rendered cards.
    expect(html).not.toMatch(/postGrid['"]\)\.innerHTML\s*=/)
    expect(html).not.toMatch(/\.featured \.wrap['"]\)\.innerHTML\s*=/)
  })
})

// ---------------------------------------------------------------------------
// Scheduled posts (2026-09-23). A post dated in the future lives in
// data/posts.json and nowhere else: no page, no card, no sitemap or llms.txt
// entry, no inbound link. .github/workflows/publish-scheduled-posts.yml
// rebuilds daily and commits, so the date in the data file IS the schedule.
//
// The failure this guards against is the quiet one: a draft going live early
// because something enumerated posts.json without filtering.
// ---------------------------------------------------------------------------
describe('scheduled posts are not on the site yet', () => {
  const index = read('blog.html')
  const sitemap = read('sitemap.xml')
  const llms = read('llms.txt')

  it('every post carries an ISO date, and the schedule is in the data file', () => {
    for (const p of allPosts) expect(p.published_date, p.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(posts.length).toBeGreaterThan(0)
  })

  it.each(scheduled.map((p) => p.slug))('%s has no page, no card, no sitemap or llms entry', (slug) => {
    expect(existsSync(join(ROOT, `blog/${slug}.html`)), `blog/${slug}.html exists`).toBe(false)
    expect(index).not.toContain(`/blog/${slug}`)
    expect(sitemap).not.toContain(`/blog/${slug}<`)
    expect(llms).not.toContain(`/blog/${slug})`)
    for (const p of posts) {
      expect(read(`blog/${p.slug}.html`), `${p.slug} links to the unpublished ${slug}`).not.toContain(`/blog/${slug}"`)
    }
  })

  it('the workflow that publishes them exists and reads the same dates', () => {
    const wf = read('.github/workflows/publish-scheduled-posts.yml')
    expect(wf).toMatch(/schedule:\s*\n\s*(#[^\n]*\n\s*)*- cron:/)
    expect(wf).toContain('node scripts/build-blog.mjs')
    expect(wf).toContain('contents: write')
    expect(wf).toContain('git push')
  })
})
