# Production-Ready Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unbundle four self-contained bundled HTML files into a clean static site with separate assets, SEO meta tags, GA4 analytics, a 404 page, sitemap, robots.txt, and Vercel configuration.

**Architecture:** A Python script (`unbundle.py`) reads each HTML file, extracts the JSON manifest (base64+gzip assets) and HTML template, writes assets to `assets/{css,js,images,fonts}/`, replaces UUID placeholders with absolute `/assets/...` paths, injects SEO and GA4 into `<head>`, and writes clean output HTML. Static files (vercel.json, 404.html, sitemap.xml, robots.txt) are written by hand.

**Tech Stack:** Python 3 (stdlib only: `base64`, `gzip`, `json`, `re`, `pathlib`), Vercel static hosting.

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `unbundle.py` | Extraction + rewrite script |
| Rewrite | `index.html` | Clean HTML with asset refs + SEO + GA4 |
| Rewrite | `pricing.html` | Clean HTML with asset refs + SEO + GA4 |
| Rewrite | `blog.html` | Clean HTML with asset refs + SEO + GA4 |
| Rename+Rewrite | `blog post.html` → `blog-post.html` | Clean HTML with asset refs + SEO + GA4 |
| Create | `assets/css/*.css` | Extracted stylesheets (generated) |
| Create | `assets/js/*.js` | Extracted scripts (generated) |
| Create | `assets/images/*` | Extracted images (generated) |
| Create | `assets/fonts/*` | Extracted fonts (generated) |
| Create | `vercel.json` | Cache headers, security headers, clean URLs |
| Create | `404.html` | Branded error page |
| Create | `sitemap.xml` | URL index for search engines |
| Create | `robots.txt` | Crawler directives |

---

### Task 1: Write `unbundle.py`

**Files:**
- Create: `Website/unbundle.py`

- [ ] **Step 1: Create `unbundle.py` with the full script**

Save this file at `Website/unbundle.py`:

```python
#!/usr/bin/env python3
"""Unbundle TradingSocial bundled HTML files into separate assets."""

import base64
import gzip
import json
import re
from pathlib import Path

# Maps MIME type → (assets subdirectory, file extension)
MIME_MAP = {
    'text/css': ('css', 'css'),
    'text/javascript': ('js', 'js'),
    'application/javascript': ('js', 'js'),
    'image/png': ('images', 'png'),
    'image/jpeg': ('images', 'jpg'),
    'image/jpg': ('images', 'jpg'),
    'image/webp': ('images', 'webp'),
    'image/svg+xml': ('images', 'svg'),
    'image/avif': ('images', 'avif'),
    'image/gif': ('images', 'gif'),
    'image/x-icon': ('images', 'ico'),
    'image/vnd.microsoft.icon': ('images', 'ico'),
    'font/woff': ('fonts', 'woff'),
    'font/woff2': ('fonts', 'woff2'),
    'font/ttf': ('fonts', 'ttf'),
    'font/otf': ('fonts', 'otf'),
    'application/font-woff': ('fonts', 'woff'),
    'application/font-woff2': ('fonts', 'woff2'),
    'application/x-font-ttf': ('fonts', 'ttf'),
    'application/json': ('js', 'json'),
}

SEO_CONFIG = {
    'index.html': {
        'title': 'TradingSocial — Track. Prove. Improve your trading.',
        'description': 'Track, prove, and improve your trading with TradingSocial — the social trading journal for serious traders.',
        'canonical': 'https://tradingsocial.com/',
    },
    'pricing.html': {
        'title': 'Pricing — TradingSocial',
        'description': 'Simple, transparent pricing for TradingSocial. Choose the plan that fits your trading goals.',
        'canonical': 'https://tradingsocial.com/pricing',
    },
    'blog.html': {
        'title': 'Blog — TradingSocial',
        'description': 'Trading insights, strategies, and platform updates from the TradingSocial team.',
        'canonical': 'https://tradingsocial.com/blog',
    },
    'blog-post.html': {
        'title': 'Blog Post — TradingSocial',
        'description': 'Read the latest trading insights and strategies on TradingSocial.',
        'canonical': 'https://tradingsocial.com/blog-post',
    },
}

PAGES = [
    ('index.html', 'index.html'),
    ('pricing.html', 'pricing.html'),
    ('blog.html', 'blog.html'),
    ('blog post.html', 'blog-post.html'),
]

GA_ID = 'G-XXXXXXXXXX'  # Replace with your GA4 Measurement ID
OG_IMAGE = 'https://tradingsocial.com/assets/images/og-image.png'


def extract_script(html: str, script_type: str) -> str | None:
    pattern = rf'<script[^>]+type="{re.escape(script_type)}"[^>]*>(.*?)</script>'
    m = re.search(pattern, html, re.DOTALL)
    return m.group(1).strip() if m else None


def decode_asset(entry: dict) -> bytes:
    data = base64.b64decode(entry['data'])
    if entry.get('compressed'):
        try:
            data = gzip.decompress(data)
        except Exception as e:
            print(f'    Warning: gzip decompression failed, using raw bytes: {e}')
    return data


def asset_path(uuid: str, mime: str) -> tuple[str, str]:
    """Returns (subdir, filename) for an asset."""
    short = uuid.replace('-', '')[:12]
    subdir, ext = MIME_MAP.get(mime, ('misc', 'bin'))
    if mime not in MIME_MAP:
        print(f'    Warning: unknown MIME {mime!r}, writing to misc/')
    return subdir, f'{short}.{ext}'


def is_text(mime: str) -> bool:
    return mime.startswith('text/') or mime in (
        'application/javascript', 'application/json', 'image/svg+xml'
    )


def build_seo_and_ga(output_name: str) -> str:
    seo = SEO_CONFIG.get(output_name, {})
    title = seo.get('title', 'TradingSocial')
    desc = seo.get('description', '')
    canonical = seo.get('canonical', 'https://tradingsocial.com/')
    lines = [
        f'  <!-- Google tag (gtag.js) -->',
        f'  <script async src="https://www.googletagmanager.com/gtag/js?id={GA_ID}"></script>',
        f'  <script>',
        f'    window.dataLayer = window.dataLayer || [];',
        f'    function gtag(){{dataLayer.push(arguments);}}',
        f'    gtag(\'js\', new Date());',
        f'    gtag(\'config\', \'{GA_ID}\');',
        f'  </script>',
        f'  <meta name="description" content="{desc}">',
        f'  <meta property="og:title" content="{title}">',
        f'  <meta property="og:description" content="{desc}">',
        f'  <meta property="og:image" content="{OG_IMAGE}">',
        f'  <meta property="og:url" content="{canonical}">',
        f'  <meta property="og:type" content="website">',
        f'  <meta name="twitter:card" content="summary_large_image">',
        f'  <meta name="twitter:title" content="{title}">',
        f'  <meta name="twitter:description" content="{desc}">',
        f'  <meta name="twitter:image" content="{OG_IMAGE}">',
        f'  <link rel="canonical" href="{canonical}">',
        f'  <link rel="icon" href="/assets/images/favicon.ico">',
    ]
    return '\n'.join(lines)


def unbundle(input_path: Path, output_path: Path, assets_root: Path):
    print(f'\nProcessing: {input_path.name} -> {output_path.name}')
    html = input_path.read_text(encoding='utf-8')

    manifest_json = extract_script(html, '__bundler/manifest')
    template_json = extract_script(html, '__bundler/template')

    if not manifest_json or not template_json:
        print(f'  Error: missing manifest or template — skipping')
        return

    manifest: dict = json.loads(manifest_json)
    template: str = json.loads(template_json)  # stored as a JSON-encoded string
    print(f'  {len(manifest)} assets found')

    # Extract assets, build uuid -> absolute web path mapping
    uuid_to_url: dict[str, str] = {}
    for uuid, entry in manifest.items():
        try:
            data = decode_asset(entry)
            mime = entry.get('mime', 'application/octet-stream')
            subdir, filename = asset_path(uuid, mime)

            dest_dir = assets_root / subdir
            dest_dir.mkdir(parents=True, exist_ok=True)
            dest_file = dest_dir / filename

            if is_text(mime):
                dest_file.write_text(data.decode('utf-8', errors='replace'), encoding='utf-8')
            else:
                dest_file.write_bytes(data)

            uuid_to_url[uuid] = f'/assets/{subdir}/{filename}'
        except Exception as e:
            print(f'  Warning: failed to extract {uuid[:8]}: {e}')
            uuid_to_url[uuid] = uuid  # leave as-is

    # Replace UUIDs in template HTML
    result = template
    for uuid, url in uuid_to_url.items():
        result = result.replace(uuid, url)

    # Replace UUIDs inside extracted CSS/JS files (e.g. url() references)
    for uuid, entry in manifest.items():
        mime = entry.get('mime', '')
        if not is_text(mime):
            continue
        subdir, filename = asset_path(uuid, mime)
        asset_file = assets_root / subdir / filename
        if not asset_file.exists():
            continue
        content = asset_file.read_text(encoding='utf-8', errors='replace')
        changed = False
        for ref_uuid, ref_url in uuid_to_url.items():
            if ref_uuid in content:
                content = content.replace(ref_uuid, ref_url)
                changed = True
        if changed:
            asset_file.write_text(content, encoding='utf-8')

    # Inject SEO + GA4 before </head>
    inject = build_seo_and_ga(output_path.name)
    if '</head>' in result:
        result = result.replace('</head>', inject + '\n</head>', 1)
    else:
        print('  Warning: no </head> tag found, SEO tags not injected')

    output_path.write_text(result, encoding='utf-8')
    print(f'  Written: {output_path.name}')


if __name__ == '__main__':
    base = Path(__file__).parent
    assets_root = base / 'assets'

    for input_name, output_name in PAGES:
        input_path = base / input_name
        output_path = base / output_name
        if not input_path.exists():
            print(f'Skipping {input_name!r}: file not found')
            continue
        unbundle(input_path, output_path, assets_root)

    print('\nAll done!')
```

- [ ] **Step 2: Verify Python 3 is available**

```bash
python --version
```

Expected: `Python 3.x.x` (any 3.8+). If not found, try `python3 --version`.

---

### Task 2: Run the unbundler and verify output

**Files:**
- Modifies: `index.html`, `pricing.html`, `blog.html`
- Creates: `blog-post.html`, `assets/css/*`, `assets/js/*`, `assets/images/*`, `assets/fonts/*`

- [ ] **Step 1: Run the script**

From inside `Website/`:
```bash
cd Website
python unbundle.py
```

Expected output (approximate):
```
Processing: index.html -> index.html
  N assets found
  Written: index.html

Processing: pricing.html -> pricing.html
  N assets found
  Written: pricing.html

Processing: blog.html -> blog.html
  N assets found
  Written: blog.html

Processing: blog post.html -> blog-post.html
  N assets found
  Written: blog-post.html

All done!
```

Any `Warning:` lines are acceptable. `Error:` lines are not — if you see one, check that the input file exists and isn't corrupted.

- [ ] **Step 2: Verify assets directory was created**

```bash
ls assets/
```

Expected: directories `css/`, `js/`, `images/`, `fonts/` (and possibly `misc/`).

```bash
ls assets/css/ | head -5
ls assets/js/ | head -5
ls assets/images/ | head -5
```

Each should list `.css`, `.js`, and image files respectively.

- [ ] **Step 3: Verify HTML files no longer contain the bundler runtime**

```bash
grep -c "__bundler/manifest" index.html
```

Expected: `0` (the bundler manifest is gone from the output HTML).

```bash
grep -c "assets/css" index.html
```

Expected: a positive number (CSS links now point to `assets/css/`).

- [ ] **Step 4: Verify SEO tags were injected**

```bash
grep "og:title" index.html
```

Expected: `<meta property="og:title" content="TradingSocial — Track. Prove. Improve your trading.">`

```bash
grep "canonical" index.html
```

Expected: `<link rel="canonical" href="https://tradingsocial.com/">`

- [ ] **Step 5: Verify GA4 snippet is present**

```bash
grep "gtag" index.html
```

Expected: two lines referencing `googletagmanager.com` and `gtag('config', ...)`.

- [ ] **Step 6: Delete the original `blog post.html` (space in name)**

Only do this after confirming `blog-post.html` was created correctly in Step 1.

```bash
# Windows PowerShell
Remove-Item "blog post.html"
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: unbundle HTML files into separate assets with SEO and GA4"
```

---

### Task 3: Create `vercel.json`

**Files:**
- Create: `Website/vercel.json`

- [ ] **Step 1: Create `vercel.json`**

```json
{
  "cleanUrls": true,
  "trailingSlash": false,
  "headers": [
    {
      "source": "/assets/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=31536000, immutable"
        }
      ]
    },
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Frame-Options", "value": "SAMEORIGIN" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        {
          "key": "Permissions-Policy",
          "value": "camera=(), microphone=(), geolocation=()"
        }
      ]
    }
  ],
  "rewrites": [
    { "source": "/blog-post", "destination": "/blog-post.html" }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add vercel.json
git commit -m "feat: add vercel.json with cache and security headers"
```

---

### Task 4: Create `404.html`

**Files:**
- Create: `Website/404.html`

- [ ] **Step 1: Create `404.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>404 — Page Not Found | TradingSocial</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #171326;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 2rem;
    }
    .container { max-width: 480px; }
    .logo-mark {
      display: block;
      margin: 0 auto 2rem;
      width: 64px;
      height: 64px;
    }
    .code {
      font-size: 6rem;
      font-weight: 700;
      line-height: 1;
      background: linear-gradient(135deg, #7C5CE6 0%, #C840BC 50%, #FF7A4D 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 1rem;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 600;
      color: #fff;
      margin-bottom: 0.75rem;
    }
    p {
      color: #9d8ec4;
      font-size: 1rem;
      line-height: 1.6;
      margin-bottom: 2rem;
    }
    a.btn {
      display: inline-block;
      padding: 0.75rem 2rem;
      background: linear-gradient(135deg, #7C5CE6, #C840BC);
      color: #fff;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      font-size: 0.95rem;
      transition: opacity 0.2s;
    }
    a.btn:hover { opacity: 0.85; }
  </style>
</head>
<body>
  <div class="container">
    <svg class="logo-mark" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#7C5CE6"/>
          <stop offset="0.5" stop-color="#C840BC"/>
          <stop offset="1" stop-color="#FF7A4D"/>
        </linearGradient>
      </defs>
      <path d="M4 48 L20 24 L34 36 L52 8" stroke="url(#g)" stroke-width="5"
            stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M44 8 L52 8 L52 16" stroke="url(#g)" stroke-width="5"
            stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <div class="code">404</div>
    <h1>Page Not Found</h1>
    <p>The page you're looking for doesn't exist or has been moved.</p>
    <a href="/" class="btn">Go Home</a>
  </div>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add 404.html
git commit -m "feat: add branded 404 error page"
```

---

### Task 5: Create `sitemap.xml` and `robots.txt`

**Files:**
- Create: `Website/sitemap.xml`
- Create: `Website/robots.txt`

- [ ] **Step 1: Create `sitemap.xml`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://tradingsocial.com/</loc>
    <lastmod>2026-06-15</lastmod>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://tradingsocial.com/pricing</loc>
    <lastmod>2026-06-15</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://tradingsocial.com/blog</loc>
    <lastmod>2026-06-15</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>
</urlset>
```

- [ ] **Step 2: Create `robots.txt`**

```
User-agent: *
Allow: /

Sitemap: https://tradingsocial.com/sitemap.xml
```

- [ ] **Step 3: Commit**

```bash
git add sitemap.xml robots.txt
git commit -m "feat: add sitemap.xml and robots.txt"
```

---

### Task 6: Final verification and push

- [ ] **Step 1: Check all expected files exist**

```bash
ls Website/
```

Expected to see: `index.html`, `pricing.html`, `blog.html`, `blog-post.html`, `404.html`, `sitemap.xml`, `robots.txt`, `vercel.json`, `assets/`, `unbundle.py`

```bash
ls Website/assets/
```

Expected: `css/`, `js/`, `images/`, `fonts/`

- [ ] **Step 2: Verify no UUID placeholders remain in HTML files**

```bash
# UUIDs match pattern xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
grep -E "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}" index.html | head -5
```

Expected: no output (all UUIDs replaced). If any remain, those were in `ext_resources` or similar — investigate before pushing.

- [ ] **Step 3: Confirm GA4 placeholder is noted**

```bash
grep "G-XXXXXXXXXX" index.html
```

Expected: two matches (the gtag.js URL and the config call). **Replace `G-XXXXXXXXXX` with the real GA4 Measurement ID** in `unbundle.py` → re-run the script → re-commit before going live.

- [ ] **Step 4: Push to GitHub**

```bash
git push origin main
```

Vercel will auto-deploy from the connected GitHub repo. Check the Vercel dashboard for the deployment URL.

- [ ] **Step 5: After deploy — verify 404 page**

Visit `https://<your-vercel-domain>/nonexistent-page`. You should see the branded TradingSocial 404 page, not Vercel's default.
