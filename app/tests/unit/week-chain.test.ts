// app/tests/unit/week-chain.test.ts
//
// Guards the "don't break the chain" week strip.
//
// The function this replaces never consulted a calendar. It placed "today" at
// index 6 unconditionally — which the M T W T F S S labels render as SUNDAY,
// every day of the week — and filled the six cells before it from
// `Math.abs(streak)`, the win/loss TRADE streak rather than days logged. So:
//
//   * on a Monday, every cell including Monday read `future`;
//   * four winning trades in one afternoon painted Mon–Thu as done;
//   * logging every day while trading flat showed an empty chain.
//
// Nothing threw. The card rendered, the boxes lit up, and the habit mechanic
// the product is built on displayed a week that had not happened. These tests
// pin it to the calendar and to the trade log.
import { describe, it, expect } from 'vitest'
import { weekChain, type ChainDay } from '@/lib/streaks'

// 2026-09-07 is a Monday; 2026-09-13 is the Sunday that ends its week.
const MON = '2026-09-07'
const TUE = '2026-09-08'
const WED = '2026-09-09'
const SUN = '2026-09-13'

/** Compact reading of a chain: D=done, T=today, M=missed, F=future. */
const shape = (days: ChainDay[]) =>
  days.map((d) => ({ done: 'D', today: 'T', missed: 'M', future: 'F' })[d]).join('')

describe('weekChain — where today lands', () => {
  it('puts today on Monday when it is Monday', () => {
    // The original bug in one assertion: this used to read FFFFFFT.
    expect(shape(weekChain([], MON))).toBe('TFFFFFF')
  })

  it('puts today on Sunday when it is Sunday', () => {
    expect(shape(weekChain([], SUN))).toBe('MMMMMMT')
  })

  it('walks across the week', () => {
    expect(shape(weekChain([], TUE))).toBe('MTFFFFF')
    expect(shape(weekChain([], WED))).toBe('MMTFFFF')
  })

  it('always returns exactly seven days', () => {
    for (const key of [MON, TUE, WED, SUN]) expect(weekChain([], key)).toHaveLength(7)
  })
})

describe('weekChain — what the cells mean', () => {
  it('marks a logged past day done and an unlogged one missed', () => {
    expect(shape(weekChain([MON], WED))).toBe('DMTFFFF')
  })

  it('marks today done once something is logged today', () => {
    expect(shape(weekChain([MON, TUE, WED], WED))).toBe('DDDFFFF')
  })

  it('never marks a future day done, whatever the log says', () => {
    // A trade dated later this week must not light a cell that has not arrived.
    const chain = weekChain([MON, SUN], MON)
    expect(shape(chain)).toBe('DFFFFFF')
  })

  it('ignores days outside this week', () => {
    // Last Monday and next Monday are both irrelevant to this week's strip.
    expect(shape(weekChain(['2026-08-31', '2026-09-14'], WED))).toBe('MMTFFFF')
  })

  it('does not care how many trades a day holds', () => {
    // The old version keyed cells off a trade COUNT. A day is a day.
    expect(shape(weekChain([MON, MON, MON], TUE))).toBe('DTFFFFF')
  })
})

describe('weekChain — the two shapes the old version got backwards', () => {
  it('shows an empty chain for a winning streak logged in one day', () => {
    // Four wins on Monday used to paint Mon–Thu done. It is one day logged.
    expect(shape(weekChain([MON], TUE))).toBe('DTFFFFF')
  })

  it('shows a full chain for someone who logged daily and traded flat', () => {
    // Win/loss streak zero, five days logged: this used to render empty.
    expect(shape(weekChain([MON, TUE, WED, '2026-09-10', '2026-09-11'], '2026-09-11')))
      .toBe('DDDDDFF')
  })
})

describe('weekChain — bad input', () => {
  it('degrades to an untouched week rather than throwing', () => {
    // A render is not worth crashing the home page over.
    expect(shape(weekChain([], 'not-a-date'))).toBe('FFFFFFF')
  })
})
