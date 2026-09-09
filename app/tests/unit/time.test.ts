// app/tests/unit/time.test.ts
//
// `timeAgo` used to end at `toLocaleDateString()` past five weeks, which broke
// two things at once.
//
// Visible: the community feed's newest post was six weeks old and every item
// read "7/24/2026". Nothing on screen said "six weeks ago", so a visitor read
// the room as quiet without learning how quiet — the one useful thing that
// timestamp could have told them.
//
// Invisible: `toLocaleDateString()` with no locale uses the RUNTIME's locale —
// the server's during SSR, the browser's during hydration. The same post
// renders "7/24/2026" and "24/07/2026" across the two passes, which is a
// hydration mismatch (React #418). It recovers silently, so it never reaches
// the error boundary or `analytics_events`.
//
// Staying relative fixes both, and makes the function testable without pinning
// a locale — which is the point.
import { describe, it, expect } from 'vitest'
import { timeAgo } from '@/lib/time'

const NOW = Date.parse('2026-09-09T12:00:00Z')
const ago = (ms: number) => timeAgo(new Date(NOW - ms).toISOString(), NOW)

const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe('timeAgo — the short end', () => {
  it('reads just now under 45 seconds', () => {
    expect(ago(0)).toBe('just now')
    expect(ago(44 * SEC)).toBe('just now')
  })

  it('counts minutes, hours and days', () => {
    expect(ago(5 * MIN)).toBe('5m')
    expect(ago(3 * HOUR)).toBe('3h')
    expect(ago(2 * DAY)).toBe('2d')
  })

  it('never runs backwards for a future timestamp', () => {
    expect(timeAgo(new Date(NOW + DAY).toISOString(), NOW)).toBe('just now')
  })
})

describe('timeAgo — the long end', () => {
  it('counts weeks up to five', () => {
    expect(ago(7 * DAY)).toBe('1w')
    expect(ago(28 * DAY)).toBe('4w')
  })

  it('keeps saying how old something is past five weeks', () => {
    // The regression that mattered: this used to return a locale-formatted
    // date, so a stale feed looked merely undated rather than stale.
    expect(ago(45 * DAY)).toBe('1mo')
    expect(ago(200 * DAY)).toBe('6mo')
  })

  it('rolls over to years', () => {
    expect(ago(400 * DAY)).toBe('1y')
    expect(ago(3 * 365 * DAY)).toBe('3y')
  })

  it('never emits a formatted date, at any age', () => {
    // A date here is locale-dependent output inside an SSR'd component, which
    // is the hydration hazard. No output may contain a date separator.
    for (const days of [1, 6, 34, 60, 400, 5000]) {
      expect(ago(days * DAY)).not.toMatch(/[/.]|-\d/)
    }
  })

  it('computes months from elapsed days, not calendar months', () => {
    // 30-day months, stated plainly so the rounding is not a surprise.
    expect(ago(90 * DAY)).toBe('3mo')
    expect(ago(364 * DAY)).toBe('12mo')
  })
})
