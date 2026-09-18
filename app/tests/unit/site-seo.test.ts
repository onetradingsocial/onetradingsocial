// app/tests/unit/site-seo.test.ts
//
// SEO audit 2026-09-18, structure findings. The marketing site is hand-edited
// single-file HTML, so none of this is enforced by a framework: each rule
// below held on some pages and not others until it was written down here.
//
// - Headings: one <h1>, and no level skipped on the way down. Footer column
//   titles were <h5>s straight after an <h2>, and FAQ questions were <h4>s
//   under an <h2>. They are now styled non-headings and <h3>s.
// - Structured data: every JSON-LD block parses, and the pricing page's
//   offers are the prices on its own plan cards.
// - Internal links: /compare/* pages were linked only from /for/* and each
//   other. Every page's footer now links all of them.
// - sitemap.xml and llms.txt list real pages.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// repo root is three levels up from app/tests/unit
const ROOT = join(__dirname, '..', '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
const SITE = 'https://www.tradingsocial.io'

const htmlIn = (dir: string) =>
  readdirSync(join(ROOT, dir))
    .filter((f) => f.endsWith('.html'))
    .map((f) => (dir === '.' ? f : `${dir}/${f}`))

/** Every page Vercel serves from the repo root (templates/ and docs/ are ignored). */
const PAGES = [...htmlIn('.'), ...htmlIn('for'), ...htmlIn('compare'), ...htmlIn('blog')]
const COMPARE = htmlIn('compare').map((f) => '/' + f.replace(/\.html$/, ''))

/** The markup a crawler parses: no scripts, styles or comments. */
const markup = (html: string) =>
  html
    .replace(/<script\b[\s\S]*?<\/script>/g, '')
    .replace(/<style\b[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')

const jsonLd = (html: string) =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1])

/** File that serves a clean URL (vercel.json has cleanUrls: true). */
const fileFor = (url: string) => {
  const path = url.replace(SITE, '').replace(/^\//, '')
  if (path === '') return 'index.html'
  return existsSync(join(ROOT, path, 'index.html')) ? `${path}/index.html` : `${path}.html`
}

it('finds the pages it is meant to check', () => {
  // A glob that silently matched nothing would pass every test below.
  expect(PAGES).toEqual(expect.arrayContaining(['index.html', 'pricing.html', 'blog.html', '404.html', 'for/index.html']))
  expect(PAGES.filter((p) => p.startsWith('blog/')).length).toBeGreaterThan(0)
  expect(COMPARE.length).toBeGreaterThan(0)
})

describe('heading hierarchy', () => {
  it.each(PAGES)('%s has one h1 and skips no level', (page) => {
    const levels = [...markup(read(page)).matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]))
    expect(levels.filter((l) => l === 1), 'exactly one <h1>').toHaveLength(1)
    // A heading may sit at most one level deeper than the one before it. The
    // first must be the h1: starting "below" 0 is the same rule.
    let prev = 0
    levels.forEach((l, i) => {
      expect(l, `heading #${i + 1} is an h${l} after an h${prev} (sequence: ${levels.join(' ')})`).toBeLessThanOrEqual(prev + 1)
      prev = l
    })
  })
})

describe('footer', () => {
  const withFooter = PAGES.filter((p) => /<footer\b/.test(read(p)))

  it('is on every page but the 404', () => {
    expect(PAGES.filter((p) => !withFooter.includes(p))).toEqual(['404.html'])
  })

  it.each(withFooter)('%s links every compare page, and its column titles are not headings', (page) => {
    const footer = read(page).match(/<footer\b[\s\S]*?<\/footer>/)![0]
    for (const href of COMPARE) expect(footer, `footer links ${href}`).toContain(`href="${href}"`)
    expect(markup(footer)).not.toMatch(/<h[1-6]\b/)
  })
})

describe('structured data', () => {
  const blocks = PAGES.flatMap((page) => jsonLd(read(page)).map((src, i) => [`${page} #${i + 1}`, src] as const))

  it.each(blocks)('%s parses as schema.org JSON-LD', (_, src) => {
    const data = JSON.parse(src)
    expect(data['@context']).toBe('https://schema.org')
    // One typed node, or a @graph of them.
    const nodes = data['@graph'] ?? [data]
    expect(nodes.length).toBeGreaterThan(0)
    for (const n of nodes) expect(typeof n['@type']).toBe('string')
  })

  it('every page that should carry it does', () => {
    const types = (page: string) =>
      jsonLd(read(page)).flatMap((s) => {
        const d = JSON.parse(s)
        return (d['@graph'] ?? [d]).map((n: { '@type': string }) => n['@type'])
      })
    expect(types('index.html')).toEqual(expect.arrayContaining(['Organization', 'SoftwareApplication']))
    expect(types('pricing.html')).toContain('SoftwareApplication')
    expect(types('blog.html')).toEqual(expect.arrayContaining(['Blog', 'BreadcrumbList']))
    for (const page of PAGES.filter((p) => p.startsWith('blog/'))) {
      expect(types(page)).toEqual(expect.arrayContaining(['BlogPosting', 'BreadcrumbList']))
    }
  })

  const app = (page: string) =>
    jsonLd(read(page))
      .map((s) => JSON.parse(s))
      .find((d) => d['@type'] === 'SoftwareApplication')

  it("pricing offers are the plan cards' monthly prices", () => {
    // Plan name and the data-monthly amount the billing toggle shows, in card order.
    const html = read('pricing.html')
    const cards = [...html.matchAll(/<span class="pcard-name">(?:<span[^>]*><\/span>)?([^<]+)<\/span>[\s\S]*?data-monthly="([^"]+)"/g)].map(
      (m) => ({ name: m[1].trim(), price: m[2] }),
    )
    expect(cards.length).toBeGreaterThan(0)
    const offers = app('pricing.html').offers
    expect(offers.map((o: { name: string; price: string }) => ({ name: o.name, price: o.price }))).toEqual(cards)
    for (const o of offers) expect(o.priceCurrency).toBe('AUD') // "All prices are in Australian dollars"
    expect(html).toMatch(/All prices are in <b>Australian dollars \(AUD\)<\/b>/)
  })

  it('pricing and the home page describe the same product and offers', () => {
    const home = app('index.html')
    const pricing = app('pricing.html')
    for (const k of ['name', 'url', 'applicationCategory', 'operatingSystem', 'offers', 'publisher']) {
      expect(pricing[k], k).toEqual(home[k])
    }
  })
})

describe('sitemap.xml', () => {
  const xml = read('sitemap.xml')
  const entries = [...xml.matchAll(/<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)].map((m) => ({ loc: m[1], lastmod: m[2] }))

  it('lists every page but the 404, and only pages that exist', () => {
    expect(entries.map((e) => fileFor(e.loc)).sort()).toEqual(PAGES.filter((p) => p !== '404.html').sort())
  })

  it('dates every entry with a real day that has already happened', () => {
    const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10)
    for (const { loc, lastmod } of entries) {
      expect(lastmod, loc).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(Number.isNaN(Date.parse(lastmod)), loc).toBe(false)
      expect(lastmod < tomorrow, `${loc} is dated ${lastmod}`).toBe(true)
    }
  })
})

describe('llms.txt', () => {
  const txt = read('llms.txt')
  const links = [...txt.matchAll(/^- \[([^\]]+)\]\(([^)]+)\): (.+)$/gm)].map((m) => ({ name: m[1], url: m[2], note: m[3] }))

  it('follows the llmstxt.org shape: H1, blockquote summary, H2 sections of links', () => {
    const lines = txt.split('\n')
    expect(lines[0]).toBe('# TradingSocial')
    expect(lines.find((l) => l.trim() !== '' && !l.startsWith('# '))).toMatch(/^> \S/)
    expect(txt.match(/^# /gm)).toHaveLength(1)
    expect(txt.match(/^## /gm)!.length).toBeGreaterThan(1)
    expect(txt).not.toMatch(/\{\{/)
  })

  it('links only to pages that exist', () => {
    expect(links.length).toBeGreaterThan(0)
    for (const { url } of links) {
      expect(url.startsWith(SITE + '/'), url).toBe(true)
      expect(existsSync(join(ROOT, fileFor(url))), url).toBe(true)
    }
  })

  it('covers every page in the sitemap', () => {
    const listed = new Set(links.map((l) => l.url))
    for (const [, loc] of read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)) expect(listed.has(loc), loc).toBe(true)
  })

  it('states the same prices as the pricing page', () => {
    const pricing = links.find((l) => l.url === `${SITE}/pricing`)!
    for (const o of JSON.parse(jsonLd(read('pricing.html'))[0]).offers) {
      if (o.price !== '0') expect(pricing.note).toContain(`${o.name} at A$${o.price}/month`)
    }
  })
})
