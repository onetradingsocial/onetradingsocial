// app/tests/unit/site-images.test.ts
//
// Page-weight guards for the static marketing site at the repo root.
//
// On 2026-09-18 the home page pulled 4.3 MB of images on first load: product
// screenshots stored as uncompressed 1-2 MB PNGs, a 300 KB brand mark drawn at
// 34 px, and 19 of 23 <img> tags with no width/height. None of that fails a
// build. These tests read the shipped HTML and assert:
//   1. every static <img> carries width, height and alt;
//   2. every local file a page references (src, srcset, poster) exists;
//   3. no raster over 400 KB is served unless the same <picture> offers an
//      AVIF or WebP <source> first;
//   4. a video poster (which cannot have a <source> fallback) stays small.
//
// Markup inside <script> is skipped: blog.html builds its cards in JS from
// data it does not control, and those strings are not static tags.
// Variants are produced by scripts/optimize-site-images.mjs.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// repo root is three levels up from app/tests/unit
const ROOT = join(__dirname, '..', '..', '..')
const MAX_UNWRAPPED_BYTES = 400 * 1024

const htmlIn = (dir: string) =>
  existsSync(join(ROOT, dir))
    ? readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.html')).map((f) => (dir ? `${dir}/${f}` : f))
    : []

/** Shipped static pages, including the posts pre-rendered by
 *  scripts/build-blog.mjs. A post that gains a cover `image` in posts.json
 *  fails here until the generator emits its width and height. */
const PAGES = [...htmlIn(''), ...htmlIn('for'), ...htmlIn('compare'), ...htmlIn('blog'), ...htmlIn('tools')]

/** Static markup only: comments and <script> bodies removed. */
const staticMarkup = (html: string) =>
  html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<script\b[\s\S]*?<\/script>/gi, ' ')

const attrs = (tag: string) => {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([a-zA-Z-:]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|[^\s>]+))?/g)) {
    out[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[2] ?? ''
  }
  return out
}

/** Local asset paths in a src/srcset/poster value; external URLs are ignored. */
const localUrls = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((c) => c.trim().split(/\s+/)[0])
    .filter((u) => u && u.startsWith('/') && !u.startsWith('//'))

const bytes = (url: string) => statSync(join(ROOT, decodeURIComponent(url.split(/[?#]/)[0]))).size
const exists = (url: string) => existsSync(join(ROOT, decodeURIComponent(url.split(/[?#]/)[0])))

type Img = { page: string; tag: string; a: Record<string, string>; modernSource: boolean; sourceUrls: string[] }

function imagesOn(page: string): Img[] {
  const html = staticMarkup(readFileSync(join(ROOT, page), 'utf8'))
  const found: Img[] = []
  // <picture> blocks first, then whatever <img> is left outside them.
  const rest = html.replace(/<picture\b[\s\S]*?<\/picture>/gi, (block) => {
    const sources = [...block.matchAll(/<source\b[^>]*>/gi)].map((m) => attrs(m[0]))
    const modernSource = sources.some((s) => /^image\/(avif|webp)$/.test(s.type ?? ''))
    const sourceUrls = sources.flatMap((s) => localUrls(s.srcset))
    for (const m of block.matchAll(/<img\b[^>]*>/gi)) {
      found.push({ page, tag: m[0], a: attrs(m[0]), modernSource, sourceUrls })
    }
    return ' '
  })
  for (const m of rest.matchAll(/<img\b[^>]*>/gi)) {
    found.push({ page, tag: m[0], a: attrs(m[0]), modernSource: false, sourceUrls: [] })
  }
  return found
}

const ALL = PAGES.flatMap(imagesOn)

describe('site images: page list', () => {
  it('covers the shipped pages', () => {
    for (const p of ['index.html', 'pricing.html', 'blog.html', '404.html', 'terms.html', 'privacy.html', 'disclaimer.html', 'for/forex.html', 'compare/tradezella-alternative.html', 'blog/position-sizing-101.html']) {
      expect(PAGES).toContain(p)
    }
    expect(ALL.length).toBeGreaterThan(40)
  })
})

describe.each(PAGES)('site images: %s', (page) => {
  const imgs = ALL.filter((i) => i.page === page)

  it('every <img> has width, height and alt', () => {
    const missing = imgs
      .filter((i) => !/^\d+$/.test(i.a.width ?? '') || !/^\d+$/.test(i.a.height ?? '') || !('alt' in i.a))
      .map((i) => i.tag)
    expect(missing).toEqual([])
  })

  it('every referenced local image exists', () => {
    const urls = imgs.flatMap((i) => [...localUrls(i.a.src), ...localUrls(i.a.srcset), ...i.sourceUrls])
    const html = staticMarkup(readFileSync(join(ROOT, page), 'utf8'))
    for (const m of html.matchAll(/<video\b[^>]*>/gi)) urls.push(...localUrls(attrs(m[0]).poster))
    expect(urls.filter((u) => !exists(u))).toEqual([])
  })

  it('no raster over 400 KB is served without an AVIF/WebP <source>', () => {
    const heavy = imgs
      .filter((i) => !i.modernSource)
      .flatMap((i) => [...localUrls(i.a.src), ...localUrls(i.a.srcset)])
      .filter((u) => /\.(png|jpe?g|gif)$/i.test(u) && exists(u) && bytes(u) > MAX_UNWRAPPED_BYTES)
    expect(heavy).toEqual([])
  })

  it('video posters stay under 400 KB (a poster has no <source> fallback)', () => {
    const html = staticMarkup(readFileSync(join(ROOT, page), 'utf8'))
    const posters = [...html.matchAll(/<video\b[^>]*>/gi)].flatMap((m) => localUrls(attrs(m[0]).poster))
    expect(posters.filter((u) => exists(u) && bytes(u) > MAX_UNWRAPPED_BYTES)).toEqual([])
  })

  it('a multi-megabyte autoplaying video is not fetched on phones', () => {
    // `autoplay` defeats preload="metadata": the whole file downloads, and the
    // hero video is 11-17 MB. Phones and reduced-motion visitors get the
    // 33 KB poster instead, so the sources must ship as data-src and be
    // promoted by the gate script, never as a plain src.
    const html = readFileSync(join(ROOT, page), 'utf8')
    for (const v of html.matchAll(/<video\b[^>]*>([\s\S]*?)<\/video>/gi)) {
      const sources = [...v[1].matchAll(/<source\b[^>]*>/gi)].map((m) => m[0])
      const heavy = sources.flatMap((s) => localUrls(attrs(s).src)).filter((u) => exists(u) && bytes(u) > MAX_UNWRAPPED_BYTES)
      expect(heavy, `${page}: heavy video source loads eagerly`).toEqual([])
      const gated = sources.flatMap((s) => localUrls(attrs(s)['data-src'])).filter((u) => exists(u) && bytes(u) > MAX_UNWRAPPED_BYTES)
      if (!gated.length) continue
      expect(v[0]).toMatch(/data-video-min-width="\d+"/)
      const script = html.slice(html.indexOf(v[0]) + v[0].length)
      expect(script).toMatch(/prefers-reduced-motion: reduce/)
      expect(script).toMatch(/min-width: ' \+ v\.dataset\.videoMinWidth/)
      // Decided once, a viewport that measures 0 at parse time never gets it.
      expect(script).toMatch(/addEventListener\('change', apply\)/)
    }
  })
})
