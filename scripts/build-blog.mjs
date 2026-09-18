// scripts/build-blog.mjs
//
// Pre-renders every post in data/posts.json to blog/<slug>.html from
// templates/blog-post.html.
//
// Posts used to be one shared shell (blog-post.html) that fetched posts.json
// and filled itself in with JavaScript. Crawlers reading the raw HTML saw ten
// copies of the same page: post 1's title and description, an empty <h1>, no
// body, and a canonical pointing at /blog-post. Each post is now a real file,
// so what a crawler reads without JavaScript is the post itself.
//
// Usage (from the repo root):
//   node scripts/build-blog.mjs          write blog/*.html
//   node scripts/build-blog.mjs --check  exit 1 if blog/ is out of date
//
// Run it after editing data/posts.json or templates/blog-post.html, and commit
// the output. There is no build step on Vercel for the marketing site.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, unlinkSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const SITE = 'https://www.tradingsocial.io'
const OG_IMAGE = `${SITE}/assets/images/og-image.png`
const LOGO = `${SITE}/assets/images/d154a54c67af4b82bd6ecee3da5fcdb5.png`
const RELATED_COUNT = 3

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const abs = (url) => (/^https?:\/\//.test(url) ? url : SITE + url)

/** "2026-06-03" → "Jun 3, 2026". Formatted in UTC: a bare ISO date is UTC
 *  midnight, and formatting it in local time (as the old client renderer did)
 *  showed the previous day to anyone west of Greenwich. */
export function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function jsonLd(post) {
  const url = `${SITE}/blog/${post.slug}`
  const data = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.excerpt,
    url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    datePublished: post.published_date,
    dateModified: post.updated_date || post.published_date,
    articleSection: post.category,
    inLanguage: 'en',
    author: { '@type': 'Person', name: post.author_name },
    publisher: {
      '@type': 'Organization',
      name: 'TradingSocial',
      url: SITE,
      logo: { '@type': 'ImageObject', url: LOGO },
    },
    image: [post.image ? abs(post.image) : OG_IMAGE],
  }
  if (post.tags?.length) data.keywords = post.tags.join(', ')
  // `<` escaped so a "</script>" inside any field cannot end the block.
  return JSON.stringify(data).replace(/</g, '\\u003c')
}

function cover(post) {
  if (post.image) {
    return `<img src="${esc(post.image)}" alt="${esc(post.title)}" style="width:100%;height:100%;object-fit:cover;border-radius:12px">`
  }
  // thumb_icon is trusted inline SVG from posts.json, inserted as-is.
  return `<div class="thumb ${esc(post.thumb_color)}"><span class="glyph">${post.thumb_icon}</span></div>`
}

function card(p) {
  const href = `/blog/${esc(p.slug)}`
  const thumb = p.image
    ? `<a class="thumb" href="${href}" style="overflow:hidden;background:#1a1330"><img src="${esc(p.image)}" alt="${esc(p.title)}" loading="lazy" style="width:100%;height:100%;object-fit:cover"></a>`
    : `<a class="thumb ${esc(p.thumb_color)}" href="${href}"><span class="glyph">${p.thumb_icon}</span><span class="thumb-lbl">${esc(p.category)}</span></a>`
  return (
    `\n      <article class="pcard-blog reveal">${thumb}<div class="pcard-body">` +
    `<span class="pcard-cat">${esc(p.category)}</span>` +
    `<h3><a href="${href}">${esc(p.title)}</a></h3>` +
    `<p class="excerpt">${esc(p.excerpt)}</p>` +
    `<div class="post-meta"><span style="width:28px;height:28px;border-radius:50%;flex-shrink:0;display:inline-block;background:${esc(p.author_color)}"></span>` +
    `<span class="pm-t"><b>${esc(p.author_name)}</b><span>${esc(fmtDate(p.published_date))}<span class="dotsep">·</span>${esc(p.readtime)}</span></span></div>` +
    `</div></article>`
  )
}

/** Same selection the client renderer made: the most recent posts, excluding this one. */
function related(post, posts) {
  return (
    posts
      .filter((p) => p.slug !== post.slug)
      .sort((a, b) => new Date(b.published_date) - new Date(a.published_date))
      .slice(0, RELATED_COUNT)
      .map(card)
      .join('') + '\n    '
  )
}

export function renderPost(template, post, posts) {
  const vars = {
    page_title: `${post.title} — TradingSocial`,
    title: post.title,
    description: post.excerpt,
    url: `${SITE}/blog/${post.slug}`,
    og_image: post.image ? abs(post.image) : OG_IMAGE,
    published_date: post.published_date,
    date_label: fmtDate(post.published_date),
    readtime: post.readtime,
    category: post.category,
    author_name: post.author_name,
    author_role: post.author_role,
    author_bio: post.author_bio,
    author_color: post.author_color,
  }
  const raw = {
    json_ld: jsonLd(post),
    cover: cover(post),
    body: post.body,
    tags: post.tags.map((t) => `<span class="tag tag--neutral">${esc(t)}</span>`).join(''),
    related: related(post, posts),
  }
  const out = template
    .replace(/<!-- TEMPLATE, not a page\.[\s\S]*?-->\r?\n/, '')
    .replace(/\{\{\{(\w+)\}\}\}/g, (_, k) => {
      if (!(k in raw)) throw new Error(`template: unknown raw placeholder {{{${k}}}}`)
      return raw[k]
    })
    .replace(/\{\{(\w+)\}\}/g, (_, k) => {
      if (!(k in vars)) throw new Error(`template: unknown placeholder {{${k}}}`)
      return esc(vars[k])
    })
  return out
}

export function loadPosts() {
  const posts = JSON.parse(readFileSync(join(ROOT, 'data', 'posts.json'), 'utf8'))
  const seen = new Set()
  for (const p of posts) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug)) throw new Error(`bad slug: ${p.slug}`)
    if (seen.has(p.slug)) throw new Error(`duplicate slug: ${p.slug}`)
    seen.add(p.slug)
  }
  return posts
}

/** Map of repo-relative path → expected file contents. */
export function buildAll() {
  const template = readFileSync(join(ROOT, 'templates', 'blog-post.html'), 'utf8')
  const posts = loadPosts()
  return new Map(posts.map((p) => [`blog/${p.slug}.html`, renderPost(template, p, posts)]))
}

function main() {
  const check = process.argv.includes('--check')
  const expected = buildAll()
  const dir = join(ROOT, 'blog')
  const existing = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith('.html')).map((f) => `blog/${f}`)
    : []

  const stale = []
  for (const [path, html] of expected) {
    const full = join(ROOT, path)
    const current = existsSync(full) ? readFileSync(full, 'utf8').replace(/\r\n/g, '\n') : null
    if (current !== html.replace(/\r\n/g, '\n')) stale.push(path)
  }
  const orphans = existing.filter((p) => !expected.has(p))

  if (check) {
    if (stale.length || orphans.length) {
      for (const p of stale) console.error(`out of date: ${p}`)
      for (const p of orphans) console.error(`no such post in data/posts.json: ${p}`)
      console.error('run: node scripts/build-blog.mjs')
      process.exit(1)
    }
    console.log(`blog/ is up to date (${expected.size} posts)`)
    return
  }

  mkdirSync(dir, { recursive: true })
  for (const path of stale) writeFileSync(join(ROOT, path), expected.get(path))
  for (const path of orphans) unlinkSync(join(ROOT, path))
  console.log(`wrote ${stale.length}, removed ${orphans.length}, ${expected.size} posts total`)
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) main()
