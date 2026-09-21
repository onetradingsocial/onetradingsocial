// scripts/build-sitemap.mjs
//
// Regenerates sitemap.xml. scripts/build-blog.mjs runs this after writing the
// blog, so one command keeps both in step; it also runs on its own:
//
//   node scripts/build-sitemap.mjs
//
// <lastmod> used to be typed by hand and every static page said 2026-08-05,
// whatever had changed since. Now it is honest by construction:
//
// - a static page's lastmod is the date of the last commit that touched its
//   file (`git log -1 --format=%cs -- <file>`). A file with uncommitted
//   changes gets today's date, which is what its commit will carry when it is
//   committed today.
// - a blog post's lastmod is its updated_date, else its published_date, from
//   data/posts.json. Rebuilding every post after a template change is not a
//   change to what the post says.
//
// The git dates are commit dates, so a squash merge on a later day moves them
// by the length of the review. That is why `build-blog.mjs --check` verifies
// the URL list and the post dates but leaves the page dates alone: it would
// otherwise fail on main for a reason that is not a mistake.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SITE = 'https://www.tradingsocial.io'

/** Static pages in sitemap order. Posts are inserted at BLOG_POSTS_AFTER. */
export const PAGES = [
  { loc: '/', file: 'index.html', changefreq: 'monthly', priority: '1.0' },
  { loc: '/pricing', file: 'pricing.html', changefreq: 'monthly', priority: '0.8' },
  { loc: '/blog', file: 'blog.html', changefreq: 'weekly', priority: '0.7' },
  { loc: '/for', file: 'for/index.html', changefreq: 'monthly', priority: '0.7' },
  { loc: '/for/journal', file: 'for/journal.html', changefreq: 'monthly', priority: '0.9' },
  { loc: '/for/forex', file: 'for/forex.html', changefreq: 'monthly', priority: '0.8' },
  { loc: '/for/crypto', file: 'for/crypto.html', changefreq: 'monthly', priority: '0.8' },
  { loc: '/for/futures', file: 'for/futures.html', changefreq: 'monthly', priority: '0.8' },
  { loc: '/for/mt5', file: 'for/mt5.html', changefreq: 'monthly', priority: '0.8' },
  { loc: '/for/prop-firm', file: 'for/prop-firm.html', changefreq: 'monthly', priority: '0.8' },
  { loc: '/for/educators', file: 'for/educators.html', changefreq: 'monthly', priority: '0.8' },
  { loc: '/tools/position-size-calculator', file: 'tools/position-size-calculator.html', changefreq: 'monthly', priority: '0.8' },
  { loc: '/tools/expectancy-calculator', file: 'tools/expectancy-calculator.html', changefreq: 'monthly', priority: '0.8' },
  { loc: '/terms', file: 'terms.html', changefreq: 'monthly', priority: '0.5' },
  { loc: '/privacy', file: 'privacy.html', changefreq: 'monthly', priority: '0.5' },
  { loc: '/disclaimer', file: 'disclaimer.html', changefreq: 'monthly', priority: '0.5' },
  { loc: '/compare/vs-trading-journal-spreadsheet', file: 'compare/vs-trading-journal-spreadsheet.html', changefreq: 'monthly', priority: '0.8' },
  { loc: '/compare/tradezella-alternative', file: 'compare/tradezella-alternative.html', changefreq: 'monthly', priority: '0.8' },
  { loc: '/compare/tradersync-alternative', file: 'compare/tradersync-alternative.html', changefreq: 'monthly', priority: '0.8' },
  { loc: '/compare/edgewonk-alternative', file: 'compare/edgewonk-alternative.html', changefreq: 'monthly', priority: '0.8' },
  { loc: '/compare/best-prop-firm-trading-journal', file: 'compare/best-prop-firm-trading-journal.html', changefreq: 'monthly', priority: '0.8' },
  { loc: '/compare/best-mt5-trading-journal', file: 'compare/best-mt5-trading-journal.html', changefreq: 'monthly', priority: '0.8' },
]
const BLOG_POSTS_AFTER = '/for/educators'

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()

/** Date of the last commit touching `file`, or today if it has uncommitted changes. */
export function gitLastmod(file) {
  const today = new Date().toISOString().slice(0, 10)
  if (git('status', '--porcelain', '--', file)) return today
  return git('log', '-1', '--format=%cs', '--', file) || today
}

/** The lastmod values sitemap.xml currently states, keyed by loc path. */
export function currentLastmods(xml = readFileSync(join(ROOT, 'sitemap.xml'), 'utf8')) {
  const out = new Map()
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)) out.set(m[1].replace(SITE, ''), m[2])
  return out
}

/**
 * @param posts     data/posts.json, newest first
 * @param lastmodOf (file) => 'YYYY-MM-DD' for a static page
 */
export function renderSitemap(posts, lastmodOf = gitLastmod) {
  const entry = (loc, lastmod, changefreq, priority) =>
    `  <url>\n    <loc>${SITE}${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>\n`
  let body = ''
  for (const p of PAGES) {
    body += entry(p.loc, lastmodOf(p.file, p.loc), p.changefreq, p.priority)
    if (p.loc === BLOG_POSTS_AFTER) {
      for (const post of posts) body += entry(`/blog/${post.slug}`, post.updated_date || post.published_date, 'monthly', '0.6')
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}</urlset>\n`
}

function main() {
  const posts = JSON.parse(readFileSync(join(ROOT, 'data', 'posts.json'), 'utf8'))
  posts.sort((a, b) => new Date(b.published_date) - new Date(a.published_date))
  writeFileSync(join(ROOT, 'sitemap.xml'), renderSitemap(posts))
  console.log('wrote sitemap.xml')
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) main()
