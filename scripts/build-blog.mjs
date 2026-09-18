// scripts/build-blog.mjs
//
// Pre-renders every post in data/posts.json to blog/<slug>.html from
// templates/blog-post.html, and renders the post list into blog.html.
//
// Posts used to be one shared shell (blog-post.html) that fetched posts.json
// and filled itself in with JavaScript. Crawlers reading the raw HTML saw ten
// copies of the same page: post 1's title and description, an empty <h1>, no
// body, and a canonical pointing at /blog-post. Each post is now a real file,
// so what a crawler reads without JavaScript is the post itself.
//
// blog.html had the same problem one level up: its featured post and card
// grid were built in the browser from posts.json, so the index shipped with
// no /blog/<slug> links at all. The script now rewrites only the regions of
// blog.html between `<!-- build-blog:<name>:start -->` and
// `<!-- build-blog:<name>:end -->` markers; everything else in that file is
// hand-edited as before. The page's script filters the rendered cards.
//
// It also writes /llms.txt from templates/llms.txt (the blog section is
// generated) and regenerates sitemap.xml via scripts/build-sitemap.mjs.
//
// Usage (from the repo root):
//   node scripts/build-blog.mjs          write everything
//   node scripts/build-blog.mjs --check  exit 1 if any output is out of date
//
// Run it after editing data/posts.json, templates/blog-post.html,
// templates/llms.txt or blog.html, and commit the output. There is no build
// step on Vercel for the marketing site.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, unlinkSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderSitemap, gitLastmod, currentLastmods } from './build-sitemap.mjs'

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

/** JSON for a <script type="application/ld+json"> block. `<` is escaped so a
 *  "</script>" inside any field cannot end the block. */
const ld = (data, space) => JSON.stringify(data, null, space).replace(/</g, '\\u003c')

const PUBLISHER = {
  '@type': 'Organization',
  name: 'TradingSocial',
  url: SITE,
  logo: { '@type': 'ImageObject', url: LOGO },
}

/** Read a file with its line endings normalised, so output is the same on a
 *  Windows checkout (core.autocrlf) as anywhere else. */
const readText = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')

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

/** Newest first — the order every list on the site uses. */
const byDate = (posts) => [...posts].sort((a, b) => new Date(b.published_date) - new Date(a.published_date))

/** The filter-chip key blog.html matches cards on: "Risk & Sizing" → "risk". */
export const catSlug = (cat) => cat.toLowerCase().split(/[\s&/]+/)[0]

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
    publisher: PUBLISHER,
    image: [post.image ? abs(post.image) : OG_IMAGE],
  }
  if (post.tags?.length) data.keywords = post.tags.join(', ')
  return ld(data)
}

/** Home › Blog › post — the same trail the page's visible crumbs start. */
function breadcrumbLd(post) {
  return ld({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE}/blog` },
      { '@type': 'ListItem', position: 3, name: post.title, item: `${SITE}/blog/${post.slug}` },
    ],
  })
}

function cover(post) {
  if (post.image) {
    return `<img src="${esc(post.image)}" alt="${esc(post.title)}" style="width:100%;height:100%;object-fit:cover;border-radius:12px">`
  }
  // thumb_icon is trusted inline SVG from posts.json, inserted as-is.
  return `<div class="thumb ${esc(post.thumb_color)}"><span class="glyph">${post.thumb_icon}</span></div>`
}

/** A post card. `filterable` adds the data-* attributes blog.html's chips and
 *  search match on. */
function card(p, { filterable = false } = {}) {
  const href = `/blog/${esc(p.slug)}`
  const attrs = filterable
    ? ` data-cat="${esc(catSlug(p.category))}" data-title="${esc(p.title)}" data-excerpt="${esc(p.excerpt)}"`
    : ''
  const thumb = p.image
    ? `<a class="thumb" href="${href}" style="overflow:hidden;background:#1a1330"><img src="${esc(p.image)}" alt="${esc(p.title)}" loading="lazy" style="width:100%;height:100%;object-fit:cover"></a>`
    : `<a class="thumb ${esc(p.thumb_color)}" href="${href}"><span class="glyph">${p.thumb_icon}</span><span class="thumb-lbl">${esc(p.category)}</span></a>`
  return (
    `\n      <article class="pcard-blog reveal"${attrs}>${thumb}<div class="pcard-body">` +
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
    byDate(posts.filter((p) => p.slug !== post.slug))
      .slice(0, RELATED_COUNT)
      .map((p) => card(p))
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
    breadcrumb_ld: breadcrumbLd(post),
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

// ---------------------------------------------------------------------------
// blog.html
// ---------------------------------------------------------------------------

/** The featured post: the newest one flagged `featured`, else the newest. */
export function pickFeatured(posts) {
  const sorted = byDate(posts)
  return sorted.find((p) => p.featured) ?? sorted[0]
}

function featuredCard(p) {
  const href = `/blog/${esc(p.slug)}`
  const thumb = p.image
    ? `<div class="thumb" style="overflow:hidden;background:#1a1330"><img src="${esc(p.image)}" alt="${esc(p.title)}" style="width:100%;height:100%;object-fit:cover"></div>`
    : `<div class="thumb ${esc(p.thumb_color)}"><span class="glyph">${p.thumb_icon}</span><span class="thumb-lbl">${esc(p.category)} · ${esc(p.readtime)} read</span></div>`
  return (
    `\n    <a class="featured-card reveal" href="${href}">${thumb}<div class="featured-body">` +
    `<span class="featured-eyebrow"><span class="star">★</span> Editor's pick</span>` +
    `<h2>${esc(p.title)}</h2>` +
    `<p>${esc(p.excerpt)}</p>` +
    `<div class="post-meta"><span style="width:32px;height:32px;border-radius:50%;flex-shrink:0;display:inline-block;background:${esc(p.author_color)}"></span>` +
    `<span class="pm-t"><b>${esc(p.author_name)}</b><span>${esc(fmtDate(p.published_date))}<span class="dotsep">·</span>${esc(p.readtime)} read</span></span></div>` +
    `<span class="featured-read">Read the article <svg viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg></span>` +
    `</div></a>\n    `
  )
}

function blogIndexLd(html, posts) {
  const description = html.match(/<meta name="description" content="([^"]*)">/)?.[1]
  if (!description) throw new Error('blog.html: no meta description')
  const url = `${SITE}/blog`
  const blog = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    '@id': `${url}#blog`,
    name: 'The TradingSocial Journal',
    url,
    // Already HTML-escaped in the meta tag; JSON-LD wants the plain text.
    description: description.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
    inLanguage: 'en',
    publisher: PUBLISHER,
    blogPost: posts.map((p) => ({
      '@type': 'BlogPosting',
      headline: p.title,
      url: `${SITE}/blog/${p.slug}`,
      datePublished: p.published_date,
      author: { '@type': 'Person', name: p.author_name },
    })),
  }
  const crumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: url },
    ],
  }
  return (
    `\n  <script type="application/ld+json">\n${ld(blog, 2)}\n  </script>` +
    `\n  <script type="application/ld+json">\n${ld(crumbs, 2)}\n  </script>\n  `
  )
}

/** Replace what sits between a region's start and end markers. */
function region(html, name, content) {
  const re = new RegExp(`(<!-- build-blog:${name}:start -->)[\\s\\S]*?(<!-- build-blog:${name}:end -->)`, 'g')
  const n = (html.match(re) || []).length
  if (n !== 1) throw new Error(`blog.html: expected one build-blog:${name} region, found ${n}`)
  return html.replace(re, (_, start, end) => start + content + end)
}

export function renderBlogIndex(html, posts) {
  const sorted = byDate(posts)
  const featured = pickFeatured(posts)
  const grid = sorted.filter((p) => p !== featured)

  // Chip counts cover the grid, as the client renderer's did: the featured
  // post sits above the filter's reach. A category without a chip could never
  // be filtered to, so that is an error rather than a silent omission.
  const chips = html.match(/<!-- build-blog:chips:start -->([\s\S]*?)<!-- build-blog:chips:end -->/)?.[1]
  if (!chips) throw new Error('blog.html: no build-blog:chips region')
  const chipCats = new Set([...chips.matchAll(/data-cat="([^"]+)"/g)].map((m) => m[1]))
  for (const p of posts) {
    if (!chipCats.has(catSlug(p.category))) throw new Error(`blog.html: no filter chip for category "${p.category}" (${p.slug})`)
  }
  const counted = chips.replace(/(data-cat="([^"]+)"[^>]*>[^<]*<span class="ct">)[^<]*(<\/span>)/g, (_, pre, cat, post) => {
    const n = cat === 'all' ? grid.length : grid.filter((p) => catSlug(p.category) === cat).length
    return pre + n + post
  })

  let out = html
  out = region(out, 'jsonld', blogIndexLd(html, sorted))
  out = region(out, 'chips', counted)
  out = region(out, 'featured', featuredCard(featured))
  out = region(out, 'count', `<span class="count">Showing ${grid.length} articles</span>`)
  out = region(out, 'cards', grid.map((p) => card(p, { filterable: true })).join('') + '\n    ')
  return out
}

// ---------------------------------------------------------------------------
// llms.txt
// ---------------------------------------------------------------------------

export function renderLlms(template, posts) {
  const list = byDate(posts)
    .map((p) => `- [${p.title}](${SITE}/blog/${p.slug}): ${p.excerpt}`)
    .join('\n')
  return template.replace(/\{\{\{(\w+)\}\}\}/g, (_, k) => {
    if (k !== 'blog_posts') throw new Error(`llms.txt template: unknown placeholder {{{${k}}}}`)
    return list
  })
}

// ---------------------------------------------------------------------------

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

/**
 * Map of repo-relative path → expected file contents.
 * @param lastmodOf how sitemap.xml dates a static page (see build-sitemap.mjs)
 */
export function buildAll({ lastmodOf = gitLastmod } = {}) {
  const template = readText(join(ROOT, 'templates', 'blog-post.html'))
  const posts = loadPosts()
  const out = new Map(posts.map((p) => [`blog/${p.slug}.html`, renderPost(template, p, posts)]))
  out.set('blog.html', renderBlogIndex(readText(join(ROOT, 'blog.html')), posts))
  out.set('llms.txt', renderLlms(readText(join(ROOT, 'templates', 'llms.txt')), posts))
  out.set('sitemap.xml', renderSitemap(byDate(posts), lastmodOf))
  return out
}

function main() {
  const check = process.argv.includes('--check')
  // --check leaves static-page dates as sitemap.xml states them (they come
  // from git history, which a squash merge rewrites); everything else in the
  // sitemap — which URLs, and each post's date — is still compared.
  let lastmodOf = gitLastmod
  if (check) {
    const current = currentLastmods()
    lastmodOf = (file, loc) => current.get(loc) ?? gitLastmod(file)
  }
  const expected = buildAll({ lastmodOf })
  const dir = join(ROOT, 'blog')
  const existing = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith('.html')).map((f) => `blog/${f}`)
    : []

  const stale = []
  for (const [path, text] of expected) {
    const full = join(ROOT, path)
    const current = existsSync(full) ? readText(full) : null
    if (current !== text) stale.push(path)
  }
  const orphans = existing.filter((p) => !expected.has(p))

  if (check) {
    if (stale.length || orphans.length) {
      for (const p of stale) console.error(`out of date: ${p}`)
      for (const p of orphans) console.error(`no such post in data/posts.json: ${p}`)
      console.error('run: node scripts/build-blog.mjs')
      process.exit(1)
    }
    console.log(`blog/, blog.html, llms.txt and sitemap.xml are up to date (${expected.size - 3} posts)`)
    return
  }

  mkdirSync(dir, { recursive: true })
  const pages = stale.filter((p) => p !== 'sitemap.xml')
  for (const path of pages) writeFileSync(join(ROOT, path), expected.get(path))
  for (const path of orphans) unlinkSync(join(ROOT, path))
  // The sitemap last: writing blog.html just now may have given it today's date.
  const sitemap = renderSitemap(byDate(loadPosts()))
  const sitemapChanged = readText(join(ROOT, 'sitemap.xml')) !== sitemap
  if (sitemapChanged) writeFileSync(join(ROOT, 'sitemap.xml'), sitemap)
  console.log(`wrote ${pages.length + (sitemapChanged ? 1 : 0)}, removed ${orphans.length}, ${expected.size - 3} posts total`)
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) main()
