// app/tests/unit/site-seo.test.ts
//
// SEO audit 2026-09-18, structure findings. The marketing site is hand-edited
// single-file HTML, so none of this is enforced by a framework: each rule
// below held on some pages and not others until it was written down here.
//
// - Headings: one <h1>, and no level skipped on the way down. Footer column
//   titles were <h5>s straight after an <h2>, and FAQ questions were <h4>s
//   under an <h2>. They are now styled non-headings and <h3>s.
// - Internal links: /compare/* pages were linked only from /for/* and each
//   other. Every page's footer now links all of them.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// repo root is three levels up from app/tests/unit
const ROOT = join(__dirname, '..', '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')

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
