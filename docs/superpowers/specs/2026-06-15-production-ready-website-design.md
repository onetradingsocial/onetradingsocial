# Production-Ready Website — Design Spec
_Date: 2026-06-15_

## Overview

The TradingSocial `Website/` directory contains four self-contained bundled HTML files exported from a design tool. Each file embeds all CSS, JS, and binary assets (images, fonts) as base64+gzip data in a JSON manifest. The runtime JS unpacks assets to blob URLs at load time. Goal: unbundle into standard static files, add SEO, analytics, a 404 page, and configure for Vercel deployment.

---

## Architecture

### Unbundle Process (`unbundle.py`)

A Python script that processes each bundled HTML:

1. Extract the JSON manifest (`<script type="__bundler/manifest">`)
2. Extract the HTML template string (`<script type="__bundler/template">`)
3. For each asset in the manifest:
   - Base64-decode the `data` field
   - Decompress with gzip if `"compressed": true`
   - Determine file extension from MIME type
   - Write to the appropriate subdirectory under `assets/`
4. Replace all UUID occurrences in the template HTML with relative file paths (e.g. `assets/css/uuid.css`)
5. Replace all UUID occurrences inside each extracted CSS file too (CSS may reference other assets via `url()`)
6. Inject SEO meta tags and GA4 snippet into the template `<head>`
7. Write final HTML to its output filename

### Asset Directory Layout

```
Website/
├── assets/
│   ├── css/          # MIME: text/css
│   ├── js/           # MIME: text/javascript, application/javascript
│   ├── images/       # MIME: image/* (png, jpg, webp, svg, avif, gif)
│   └── fonts/        # MIME: font/*, application/font-*
├── index.html
├── pricing.html
├── blog.html
├── blog-post.html    # renamed from "blog post.html" (space removed)
├── 404.html
├── sitemap.xml
├── robots.txt
├── vercel.json
└── unbundle.py
```

### File Naming

Assets are named by their UUID slug (first 8 chars of UUID) plus extension to keep paths short and collision-free. Example: `assets/css/d269bc3b.css`.

---

## SEO

Each page gets these tags injected into `<head>`:

```html
<meta name="description" content="...">
<meta property="og:title" content="...">
<meta property="og:description" content="...">
<meta property="og:image" content="https://tradingsocial.com/assets/images/og-image.png">
<meta property="og:url" content="https://tradingsocial.com/...">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="...">
<meta name="twitter:description" content="...">
<meta name="twitter:image" content="...">
<link rel="canonical" href="https://tradingsocial.com/...">
<link rel="icon" href="/assets/images/favicon.png">
```

Per-page descriptions:

| Page | Description |
|------|-------------|
| index | Track, prove, and improve your trading with TradingSocial — the social trading journal for serious traders. |
| pricing | Simple, transparent pricing for TradingSocial. Choose the plan that fits your trading goals. |
| blog | Trading insights, strategies, and platform updates from the TradingSocial team. |
| blog-post | (dynamic — uses existing `<title>` content) |

---

## Google Analytics 4

GA4 snippet injected into every `<head>` immediately after the `<meta charset>` tag:

```html
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=MEASUREMENT_ID"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'MEASUREMENT_ID');
</script>
```

`MEASUREMENT_ID` is a placeholder (format `G-XXXXXXXXXX`) — user replaces with real ID.

**SRI note:** Subresource Integrity (`integrity="sha384-..."`) cannot be applied to `gtag.js` — Google rotates its content continuously, so a static hash would immediately break analytics. This is a known, accepted trade-off for GA4. If SRI compliance is required, the alternative is a self-hosted analytics solution (e.g. Plausible, Umami) which loads no external scripts.

---

## `vercel.json`

```json
{
  "cleanUrls": true,
  "trailingSlash": false,
  "headers": [
    {
      "source": "/assets/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
      ]
    },
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Frame-Options", "value": "SAMEORIGIN" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" }
      ]
    }
  ],
  "rewrites": [
    { "source": "/blog-post", "destination": "/blog-post.html" }
  ]
}
```

`cleanUrls: true` means Vercel serves `index.html` at `/`, `pricing.html` at `/pricing`, `blog.html` at `/blog`, `blog-post.html` at `/blog-post`.

---

## `404.html`

A branded dark-themed error page matching TradingSocial's `#171326` background and gradient palette (`#7C5CE6` → `#C840BC` → `#FF7A4D`). Contains:
- "404 — Page Not Found" heading
- One-line message
- "Go Home" button linking to `/`

---

## `sitemap.xml`

Static sitemap listing all public pages with `<lastmod>` set to today's date:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://tradingsocial.com/</loc><lastmod>2026-06-15</lastmod></url>
  <url><loc>https://tradingsocial.com/pricing</loc><lastmod>2026-06-15</lastmod></url>
  <url><loc>https://tradingsocial.com/blog</loc><lastmod>2026-06-15</lastmod></url>
</urlset>
```

(Blog posts are dynamically generated so not listed individually.)

---

## `robots.txt`

```
User-agent: *
Allow: /
Sitemap: https://tradingsocial.com/sitemap.xml
```

---

## Error Handling in Unbundler

- If an asset UUID appears in the template but not in the manifest: log a warning and leave the UUID as-is (don't crash).
- If decompression fails: log a warning, write the raw bytes (may be uncompressed despite the flag).
- If a MIME type is unrecognised: write to `assets/misc/` with `.bin` extension.

---

## Out of Scope

- No server-side rendering or API routes
- No build pipeline added (Vite, webpack, etc.)
- No accessibility audit (separate task)
- No performance budget enforcement
