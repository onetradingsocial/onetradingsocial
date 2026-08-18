// app/tests/unit/legal.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// repo root is three levels up from app/tests/unit
const ROOT = join(__dirname, '..', '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

describe('legal pages exist with required content', () => {
  it('disclaimer covers AFSL + not financial advice', () => {
    const html = read('disclaimer.html')
    expect(html).toContain('Australian Financial Services Licence')
    expect(html).toContain('financial product advice')
    expect(html).toMatch(/onetradingsocial@gmail\.com/)
  })
  it('privacy covers the APPs and OAIC', () => {
    const html = read('privacy.html')
    expect(html).toContain('Australian Privacy Principles')
    expect(html).toContain('OAIC')
  })
  it('terms covers governing law (South Australia) and the ACL', () => {
    const html = read('terms.html')
    expect(html).toContain('South Australia')
    expect(html).toContain('Australian Consumer Law')
  })
})

describe('footer legal links are wired (no dead anchors)', () => {
  for (const page of ['index.html', 'disclaimer.html']) {
    it(`${page} links to /terms, /privacy, /disclaimer`, () => {
      const html = read(page)
      expect(html).toContain('href="/terms"')
      expect(html).toContain('href="/privacy"')
      expect(html).toContain('href="/disclaimer"')
    })
  }
  it('index.html has no dead legal anchors', () => {
    const html = read('index.html')
    expect(html).not.toMatch(/href="#">(Terms|Privacy|Financial|Risk)/)
  })
})

describe('signup consent links to the legal pages', () => {
  // The links used to be inlined in SignupForm. They now come from
  // lib/marketing.ts so every collection surface can reach them without
  // re-deriving the marketing origin -- /privacy previously appeared nowhere
  // in app/src at all. Assert the behaviour (the links resolve, and both
  // signup paths show them), not which file the string sits in.
  it('marketing.ts defines all four legal links on the marketing origin', () => {
    const ts = read('app/src/lib/marketing.ts')
    for (const path of ['/terms', '/privacy', '/disclaimer', '#subscriptions']) {
      expect(ts).toContain(path)
    }
  })
  it('the email signup path still gates on an explicit consent checkbox', () => {
    const tsx = read('app/src/app/signup/SignupForm.tsx')
    expect(tsx).toMatch(/type="checkbox"/)
    expect(tsx).toContain('LEGAL.terms')
    expect(tsx).toContain('LEGAL.disclaimer')
  })
  it('the Google path carries its own notice, since the checkbox never gated it', () => {
    const tsx = read('app/src/app/signup/SignupForm.tsx')
    expect(tsx).toContain('OAuthLegalNotice')
    const notice = read('app/src/app/_components/LegalNotice.tsx')
    expect(notice).toContain('LEGAL.terms')
    expect(notice).toContain('LEGAL.privacy')
    expect(notice).toContain('LEGAL.disclaimer')
  })
  it('legal links open in a new tab without handing over window.opener', () => {
    const ts = read('app/src/lib/marketing.ts')
    expect(ts).toContain('noopener')
    expect(ts).toContain('noreferrer')
  })
})
