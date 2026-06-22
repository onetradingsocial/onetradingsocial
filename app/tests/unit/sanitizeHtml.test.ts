import { describe, it, expect } from 'vitest'
import { sanitizeLessonHtml } from '@/lib/sanitizeHtml'

describe('sanitizeLessonHtml', () => {
  it('keeps allowed tags and links', () => {
    const out = sanitizeLessonHtml('<p>Hi <strong>there</strong> <a href="https://x.com">x</a></p>')
    expect(out).toContain('<strong>there</strong>')
    expect(out).toContain('href="https://x.com"')
  })
  it('strips script tags', () => {
    expect(sanitizeLessonHtml('<p>ok</p><script>alert(1)</script>')).not.toContain('<script>')
  })
  it('strips event handlers and javascript: hrefs', () => {
    const out = sanitizeLessonHtml('<a href="javascript:alert(1)" onclick="x()">bad</a>')
    expect(out).not.toContain('onclick')
    expect(out).not.toContain('javascript:')
  })
  it('drops disallowed tags but keeps inner text', () => {
    expect(sanitizeLessonHtml('<div><iframe></iframe>hello</div>')).toContain('hello')
    expect(sanitizeLessonHtml('<iframe src="x"></iframe>')).not.toContain('<iframe')
  })
})
