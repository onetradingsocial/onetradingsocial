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
  it('SignupForm references /terms and /disclaimer', () => {
    const tsx = read('app/src/app/signup/SignupForm.tsx')
    expect(tsx).toContain('/terms')
    expect(tsx).toContain('/disclaimer')
  })
})
