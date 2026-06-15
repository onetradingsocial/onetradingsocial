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
        f"    gtag('js', new Date());",
        f"    gtag('config', '{GA_ID}');",
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
