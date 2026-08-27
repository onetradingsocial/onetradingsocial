import { describe, it, expect } from 'vitest'
import { isForexOpen } from '@/lib/market-hours'

const at = (iso: string) => new Date(iso)

describe('isForexOpen', () => {
  it('is open Monday through Thursday, at any hour', () => {
    // 2026-08-24 is a Monday, 08-27 a Thursday.
    expect(isForexOpen(at('2026-08-24T00:00:00Z'))).toBe(true)
    expect(isForexOpen(at('2026-08-25T12:00:00Z'))).toBe(true)
    expect(isForexOpen(at('2026-08-26T23:59:00Z'))).toBe(true)
    expect(isForexOpen(at('2026-08-27T22:00:00Z'))).toBe(true)
  })

  it('closes at 22:00 UTC on Friday, not before', () => {
    // 2026-08-28 is a Friday.
    expect(isForexOpen(at('2026-08-28T21:59:00Z'))).toBe(true)
    expect(isForexOpen(at('2026-08-28T22:00:00Z'))).toBe(false)
    expect(isForexOpen(at('2026-08-28T23:59:00Z'))).toBe(false)
  })

  it('is closed all of Saturday', () => {
    expect(isForexOpen(at('2026-08-29T00:00:00Z'))).toBe(false)
    expect(isForexOpen(at('2026-08-29T12:00:00Z'))).toBe(false)
    expect(isForexOpen(at('2026-08-29T23:59:00Z'))).toBe(false)
  })

  it('reopens at 22:00 UTC on Sunday, not before', () => {
    // 2026-08-30 is a Sunday.
    expect(isForexOpen(at('2026-08-30T00:00:00Z'))).toBe(false)
    expect(isForexOpen(at('2026-08-30T21:59:00Z'))).toBe(false)
    expect(isForexOpen(at('2026-08-30T22:00:00Z'))).toBe(true)
  })

  it('closes for ~48 hours, which is the whole point of the weekend shutdown', () => {
    // Friday close to Sunday open, sampled hourly, must be entirely closed.
    const start = Date.parse('2026-08-28T22:00:00Z')
    const open = Date.parse('2026-08-30T22:00:00Z')
    expect((open - start) / 3_600_000).toBe(48)
    for (let t = start; t < open; t += 3_600_000) {
      expect(isForexOpen(new Date(t))).toBe(false)
    }
  })

  it('is open for the rest of the week, sampled hourly', () => {
    // Sunday open through Friday close: no accidental gap in the middle.
    const open = Date.parse('2026-08-30T22:00:00Z')
    const close = Date.parse('2026-09-04T22:00:00Z')
    for (let t = open; t < close; t += 3_600_000) {
      expect(isForexOpen(new Date(t))).toBe(true)
    }
  })
})
