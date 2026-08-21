import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// repo root is three levels up from app/tests/unit
const ROOT = join(__dirname, '..', '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const page = (route: string) => read(`app/src/app/${route}/page.tsx`)

// Pull the string literal out of `title: '...'` in a page's metadata export.
function metadataTitle(source: string): string | null {
  const m = source.match(/export const metadata[^=]*=\s*{[\s\S]*?title:\s*'([^']+)'/)
  return m ? m[1] : null
}

// The four public routes that used to inherit the bare root-layout title, plus
// the two that already carried one and define the house style.
const TITLED_ROUTES: [route: string, title: string][] = [
  ['login', 'Log in — TradingSocial'],
  ['signup', 'Create your free profile — TradingSocial'],
  ['forgot-password', 'Reset your password — TradingSocial'],
  ['leaderboard', 'Leaderboard — TradingSocial'],
  ['changelog', 'Changelog — TradingSocial'],
  ['demo', 'Demo journal — TradingSocial'],
]

describe('page titles', () => {
  it('the root layout is a bare brand name with no title template', () => {
    // This is *why* every page spells the ` — TradingSocial` suffix out itself.
    // If a title.template is ever added here, the per-page titles below have to
    // drop their suffix or they will render it twice.
    const layout = read('app/src/app/layout.tsx')
    expect(metadataTitle(layout)).toBe('TradingSocial')
    // `template:` as a metadata key — not the unrelated entitlement flags in
    // this file that happen to contain the word "templates".
    expect(layout).not.toMatch(/\btemplate:/)
  })

  for (const [route, title] of TITLED_ROUTES) {
    describe(`/${route}`, () => {
      it('exports a page-specific title, so it cannot fall back to the bare brand', () => {
        expect(metadataTitle(page(route))).toBe(title)
      })

      it('follows the house style: specific name, em dash, brand suffix', () => {
        expect(title).toMatch(/^[^—]+ — TradingSocial$/)
        // The distinctive half must actually say something about the page.
        expect(title.replace(' — TradingSocial', '')).not.toBe('TradingSocial')
      })

      it('is a Server Component, which is what makes the metadata export legal', () => {
        // Next.js silently ignores `export const metadata` in a Client
        // Component. If one of these ever gains 'use client', the title stops
        // rendering with no build error — this is the tripwire for that.
        expect(page(route)).not.toMatch(/^\s*['"]use client['"]/m)
      })
    })
  }
})
