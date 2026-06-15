# Dynamic Blog System — Design Spec
_Date: 2026-06-15_

## Overview

Convert the static, hardcoded `blog.html` and `blog-post.html` pages into a data-driven system. All post content lives in a single `data/posts.json` file. Both pages fetch that file at runtime and render HTML via vanilla JavaScript. URLs are clean paths (`/blog/slug`) handled by a Vercel rewrite rule.

---

## Data — `data/posts.json`

A JSON array of post objects. Each object has:

```json
{
  "slug": "why-a-trading-journal",
  "title": "Why a trading journal is the highest-ROI habit you're not building",
  "excerpt": "Most traders track P&L and call it a day...",
  "category": "Journaling",
  "tags": ["journaling", "process", "review"],
  "readtime": "9 min",
  "published_date": "2026-06-03",
  "author_name": "Maya Okonkwo",
  "author_role": "Editor",
  "author_bio": "Maya writes about trading psychology and process.",
  "author_color": "linear-gradient(135deg,#7C5CE6,#C840BC)",
  "featured": true,
  "thumb_color": "t-violet",
  "thumb_icon": "<svg viewBox=\"0 0 24 24\" fill=\"none\">...</svg>",
  "body": "<p>Full HTML body content...</p>"
}
```

**Field reference:**

| Field | Type | Notes |
|-------|------|-------|
| `slug` | string | URL-safe, kebab-case. Unique. Used in `/blog/slug` path. |
| `title` | string | Full article title |
| `excerpt` | string | 1–2 sentence summary shown on cards and in article standfirst |
| `category` | string | e.g. "Journaling", "Analytics", "Risk & Sizing", "Psychology", "Strategy", "Beginner" |
| `tags` | string[] | Array of lowercase tag strings |
| `readtime` | string | e.g. "9 min" |
| `published_date` | string | ISO 8601: "2026-06-03" |
| `author_name` | string | Display name |
| `author_role` | string | e.g. "Editor", "Quantitative Analyst" |
| `author_bio` | string | Short bio shown in article footer |
| `author_color` | string | CSS gradient for avatar background |
| `featured` | boolean | Exactly one post should be `true` — renders in hero slot on blog page |
| `thumb_color` | string | CSS class: t-violet, t-cyan, t-green, t-mag, t-orange |
| `thumb_icon` | string | SVG string for the card thumbnail icon |
| `image` | string \| null | Optional. URL to cover image (relative `/assets/images/...` or absolute). If present, renders as `<img>` in the cover slot on both the card and article page. If absent/null, falls back to gradient+icon. |
| `body` | string | Full article body as an HTML string |

**Seeded content:** 10 posts from the existing hardcoded cards in `blog.html` plus the post from `blog_post_payload.json` in the repo root. Slugs are derived from titles (lowercase, spaces → hyphens, punctuation stripped).

---

## URL Routing

**Vercel rewrite** added to `vercel.json`:

```json
{ "source": "/blog/:slug", "destination": "/blog-post.html" }
```

`blog-post.html` reads the slug:

```js
const slug = window.location.pathname.split('/').pop();
```

If `slug` is empty or not found in the JSON, JS redirects to `/blog`.

---

## `blog-post.html` — Dynamic Rendering

The existing page structure (`.article-hero`, `.article-body`, `.article-foot`) is preserved as a skeleton. All hardcoded text content is replaced with empty placeholder elements that JS fills.

**On page load (vanilla JS, inline `<script>` at bottom of body):**

1. Read slug from `window.location.pathname`
2. `fetch('/data/posts.json')`
3. Find post where `post.slug === slug`
4. If not found → `window.location.href = '/blog'`
5. Populate DOM:
   - `<h1>` ← `post.title`
   - `.standfirst` ← `post.excerpt`
   - `.crumbs` category link ← `post.category`
   - Author name, date, readtime ← `post.author_name`, `post.published_date`, `post.readtime`
   - `.article-cover` — if `post.image` is set, render `<img src="post.image" alt="post.title">` with `object-fit: cover`; otherwise render gradient block with `post.thumb_color` + `post.thumb_icon`
   - `.prose` ← `post.body` (set via `innerHTML`)
   - `.article-tags` ← `post.tags` rendered as `<span>` chips
   - Author bio block ← `post.author_name`, `post.author_role`, `post.author_bio`, `post.author_color`
6. Update `<title>` ← `post.title + " — TradingSocial"`
7. Update OG/Twitter meta tags: `og:title`, `og:description`, `og:url`
8. Update canonical `<link>` ← `https://tradingsocial.com/blog/` + slug

**Related posts:** The two `.pcard-blog` cards below the article body are populated with the 2 most recent posts (excluding current), linking to `/blog/slug`.

---

## `blog.html` — Dynamic Grid

The existing layout shell (hero, search, filter buttons, `.featured` section, `#postGrid`, footer) is preserved. All hardcoded `<article>` and `<a class="featured-card">` elements are removed. JS renders them.

**On page load:**

1. `fetch('/data/posts.json')`
2. Sort posts by `published_date` descending
3. Find `post.featured === true` → render featured card in `.featured .wrap`
4. Remaining posts → render `<article class="pcard-blog reveal" data-cat="...">` into `#postGrid`. Card thumbnail: if `post.image` set, render `<img>` with `object-fit: cover`; otherwise render gradient block with `post.thumb_color` + `post.thumb_icon`
5. Each card links to `/blog/post.slug`
6. Update `.count` span ← `"Showing N articles"`

**Category filter:** Existing filter buttons already have `data-filter` attributes. JS attaches click handlers that show/hide cards by matching `data-cat` on each article. Active filter button gets `class="active"`. "All" shows everything.

**Search:** Existing `.blog-search` form filters cards client-side by matching the input value against `post.title + post.excerpt` (case-insensitive). Fires on `input` event, no submit needed.

---

## Error Handling

- `fetch` fails → show a brief inline error message ("Could not load posts. Please refresh.")  in place of the grid/article; do not crash silently
- Post slug not found → redirect to `/blog`
- `featured: true` missing from all posts → first post in sorted order used as featured

---

## Files Changed

| Action | Path |
|--------|------|
| Create | `Website/data/posts.json` |
| Modify | `Website/blog-post.html` — replace hardcoded content with JS loader |
| Modify | `Website/blog.html` — replace hardcoded cards with JS renderer |
| Modify | `Website/vercel.json` — add `/blog/:slug` rewrite |

---

## Out of Scope

- No pagination (all posts load at once; fine for < 50 posts)
- No CMS UI (posts added by editing `data/posts.json` and pushing)
- No server-side rendering
- No build step
