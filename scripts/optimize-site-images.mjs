#!/usr/bin/env node
/**
 * Responsive / modern-format variants for images on the static marketing site.
 *
 * Run from the repo root after `npm ci` in app/ (sharp ships with Next):
 *   node scripts/optimize-site-images.mjs
 *
 * Output goes under assets/images/, which vercel.json serves with
 * `immutable` caching. A cached URL never revalidates, so if a source image
 * changes, change the output NAMES too (e.g. bump a suffix) — never regenerate
 * different pixels under a name that has already shipped.
 *
 * Widths were chosen from measured display widths (2026-09-18):
 *   - hero / for-page lead screenshot: 998 CSS px max (hero-preview is 1000px)
 *   - showcase / for-page second screenshot: 654 px in the two-column layout,
 *     up to ~854 px once it stacks below 920px
 *   - QuickTrade: max-height 620px, so at most 342 px wide (native is 490)
 *   - brand mark: 34 px box; review avatars 38 px; hero-proof avatars 26 px
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { statSync, writeFileSync, readFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(ROOT, 'app', 'package.json'))
const sharp = require('sharp')

const IMG = join(ROOT, 'assets', 'images')
const AVIF = { quality: 72, effort: 6 } // q60 flattened the pale pill backgrounds in the screenshots
const WEBP = { quality: 85, effort: 6 }

/** Product screenshots: AVIF + WebP at each width, plus a lossless PNG
 *  recompression of the original in place (pixel-identical; the originals
 *  were stored essentially uncompressed). */
const SCREENSHOTS = {
  Dashboard: [480, 800, 1200, 1600, 1957],
  Journal: [480, 800, 1200, 1440],
  Leaderboard: [480, 800, 1200, 1600, 1918],
  QuickTrade: [490],
}

/** Small raster art displayed at a fixed CSS size: WebP at 2x and 3x.
 *  The originals stay as the <img> fallback. */
const SMALL = [
  ...['james-m', 'sara-k', 'diego-r', 'nathan-o', 'priya-l', 'marcus-c'].map((n) => ({
    src: `reviews/${n}.jpg`, out: `reviews/${n}`, widths: [76, 114],
  })),
  ...['trader-1.jpg', 'trader-2.png', 'trader-3.jpg', 'trader-4.jpg'].map((f) => ({
    src: `avatars/${f}`, out: `avatars/${f.replace(/\.\w+$/, '')}`, widths: [52, 78],
  })),
]

const kb = (n) => `${(n / 1024).toFixed(1)} KB`
const log = (p) => console.log(`  ${p.padEnd(44)} ${kb(statSync(join(IMG, p)).size)}`)

async function samePixels(a, b) {
  const [x, y] = await Promise.all([a, b].map((s) => sharp(s).ensureAlpha().raw().toBuffer()))
  return x.equals(y)
}

async function screenshots() {
  for (const [name, widths] of Object.entries(SCREENSHOTS)) {
    const src = join(IMG, `${name}.png`)
    const original = readFileSync(src)
    const { width } = await sharp(original).metadata()
    for (const w of widths) {
      if (w > width) throw new Error(`${name}: ${w}w is wider than the ${width}px source`)
      const base = sharp(original).resize({ width: w, withoutEnlargement: true })
      await base.clone().avif(AVIF).toFile(join(IMG, `${name}-${w}.avif`))
      await base.clone().webp(WEBP).toFile(join(IMG, `${name}-${w}.webp`))
      log(`${name}-${w}.avif`); log(`${name}-${w}.webp`)
    }
    const png = await sharp(original).removeAlpha().png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
    if (png.length < original.length) {
      if (!(await samePixels(original, png))) throw new Error(`${name}.png: recompression changed pixels`)
      writeFileSync(src, png)
    }
    log(`${name}.png`)
  }
}

/** The brand mark is a 507x602 PNG drawn in a 34px box. Resize it (same
 *  aspect ratio, so object-fit: contain lays it out identically) to 64px and
 *  128px tall. The hashed originals are left in place for external references. */
async function logo() {
  const src = join(IMG, 'd154a54c67af4b82bd6ecee3da5fcdb5.png')
  for (const h of [64, 128]) {
    const base = sharp(src).resize({ height: h })
    await base.clone().png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(join(IMG, `logo-mark-${h}.png`))
    await base.clone().webp({ quality: 90, alphaQuality: 100, effort: 6 }).toFile(join(IMG, `logo-mark-${h}.webp`))
    log(`logo-mark-${h}.png`); log(`logo-mark-${h}.webp`)
  }
}

async function small() {
  for (const { src, out, widths } of SMALL) {
    for (const w of widths) {
      await sharp(join(IMG, src)).resize({ width: w }).webp({ quality: 82, effort: 6 }).toFile(join(IMG, `${out}-${w}.webp`))
      log(`${out}-${w}.webp`)
    }
  }
}

/** Hero video poster: same 1920x1080 frame, WebP. Rendered at 38% opacity
 *  with an overlay blend, and it is the home page's LCP candidate. */
async function poster() {
  const dir = join(ROOT, 'assets', 'videos')
  await sharp(join(dir, 'website-hero-poster.jpg')).webp({ quality: 85, effort: 6 }).toFile(join(dir, 'website-hero-poster.webp'))
  console.log(`  ${'../videos/website-hero-poster.webp'.padEnd(44)} ${kb(statSync(join(dir, 'website-hero-poster.webp')).size)}`)
}

await screenshots()
await logo()
await small()
await poster()
