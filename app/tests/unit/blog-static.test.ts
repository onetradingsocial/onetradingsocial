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
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

type Post = { slug: string; title: string; excerpt: string; body: string }
const posts: Post[] = JSON.parse(read('data/posts.json'))
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

    const ld = JSON.parse(one(html, /<script type="application\/ld\+json">([^<]*)<\/script>/, 'JSON-LD block'))
    expect(ld['@type']).toBe('BlogPosting')
    expect(ld.headline).toBe(post.title)
    expect(ld.mainEntityOfPage['@id']).toBe(url)
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

  it('the sitemap lists exactly the generated posts', () => {
    const sitemap = read('sitemap.xml')
    const listed = [...sitemap.matchAll(/<loc>https:\/\/www\.tradingsocial\.io\/blog\/([^<]+)<\/loc>/g)].map((m) => m[1])
    const generated = readdirSync(join(ROOT, 'blog')).map((f) => f.replace(/\.html$/, ''))
    expect(listed.sort()).toEqual(generated.sort())
  })
})
