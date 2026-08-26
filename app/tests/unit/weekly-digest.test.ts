import { describe, it, expect } from 'vitest'
import { weeklyDigestHtml } from '@/lib/server/email'
import { journaledCloseAt, type XpTrade } from '@/lib/xp'

/**
 * The weekly digest reports a trader's own numbers back to them, so a figure it
 * cannot compute must be absent, not zero.
 *
 * A stop-less quick entry closes with an outcome and a P/L but no r_multiple.
 * The digest used to require a non-null r_multiple just to include a trade at
 * all — the same gate lib/trade.ts documents having already been removed from
 * the journal and profile stats. In production that gate was total: every
 * closed trade had a null r_multiple, so the digest had never sent to anyone.
 *
 * Removing it exposed the second half of the bug. Summing with `?? 0` and
 * rendering `+0.0R` states a break-even week as fact when R was never measured
 * — which, in the one email that exists to prove the numbers are trustworthy,
 * is worse than sending nothing.
 */
describe('weeklyDigestHtml — Net R is omitted, never fabricated', () => {
  const base = {
    name: 'Sam',
    trades: 3,
    winRate: 0.5,
    improvement: 'i',
    mistake: 'm',
    insight: 'n',
    action: 'a',
  }

  it('omits the Net R row entirely when no trade that week carried an R', () => {
    const html = weeklyDigestHtml({ ...base, netR: null })
    expect(html).not.toContain('Net R')
    expect(html).not.toContain('0.0R')
    // The rest of the digest still reports — a week without R is still a week.
    expect(html).toContain('Trades closed')
    expect(html).toContain('Win rate')
  })

  it('renders Net R with an explicit sign when it is measurable', () => {
    expect(weeklyDigestHtml({ ...base, netR: 2.35 })).toContain('+2.4R')
    expect(weeklyDigestHtml({ ...base, netR: -1.2 })).toContain('-1.2R')
  })

  it('renders a genuine break-even week as +0.0R', () => {
    // Zero is a real answer when it was actually computed. Only null is absent,
    // so the two cases must stay distinguishable.
    expect(weeklyDigestHtml({ ...base, netR: 0 })).toContain('+0.0R')
  })
})

/**
 * ── Which week a trade belongs to ───────────────────────────────────────────
 *
 * The digest used to select its week with `traded_at >= weekAgo`, which
 * measures when the market moved — not when the user did anything.
 *
 * The only back-log in production traded 2026-08-05 20:38Z and was journaled
 * 08-12 09:33Z, and it cleared the seven-day window by roughly seven hours.
 * It was not dropped; it came close. A back-log a day later, or any write-up
 * of a week older than seven days, produces no review for the week the work
 * actually happened in.
 *
 * The rule is now `journaledCloseAt` — XP's own bucketing, exported rather
 * than reimplemented so the two can never disagree about which week a trade
 * falls in.
 */
describe('journaledCloseAt — the digest buckets on journaling, not trade date', () => {
  const t = (over: Partial<XpTrade> = {}): XpTrade => ({
    traded_at: '2026-08-05T00:00:00.000Z',
    closed_at: '2026-08-05T00:00:00.000Z',
    created_at: '2026-08-05T00:00:00.000Z',
    status: 'closed',
    outcome: 'win',
    ...over,
  })
  const at = (iso: string) => Date.parse(iso)

  it('credits a back-logged trade to the week it was logged, not traded', () => {
    // The real production row: traded 08-05, logged and closed 08-12.
    const ts = journaledCloseAt(t({
      traded_at: '2026-08-05T00:00:00.000Z',
      created_at: '2026-08-12T09:33:37.905Z',
      closed_at: '2026-08-12T09:33:37.905Z',
    }))
    expect(ts).toBe(at('2026-08-12T09:33:37.905Z'))
  })

  it('still credits it when the trade date has fallen out of the window', () => {
    // The case the old rule could not survive: written up more than a week
    // after the trade. `traded_at` is long gone; the work happened today.
    const ts = journaledCloseAt(t({
      traded_at: '2026-08-01T00:00:00.000Z',
      created_at: '2026-08-20T00:00:00.000Z',
      closed_at: '2026-08-20T00:00:00.000Z',
    }))!
    const weekAgo = at('2026-08-21T00:00:00.000Z') - 7 * 864e5
    expect(ts).toBeGreaterThanOrEqual(weekAgo)
    expect(at('2026-08-01T00:00:00.000Z')).toBeLessThan(weekAgo)
  })

  it('leaves a same-day trader exactly where they were', () => {
    expect(journaledCloseAt(t())).toBe(at('2026-08-05T00:00:00.000Z'))
  })

  it('buckets an open-Monday close-Wednesday trade on the Wednesday', () => {
    expect(journaledCloseAt(t({
      created_at: '2026-08-03T00:00:00.000Z',
      closed_at: '2026-08-05T00:00:00.000Z',
    }))).toBe(at('2026-08-05T00:00:00.000Z'))
  })

  it('never precedes the moment the row was written', () => {
    // A user-supplied closed_at before created_at is an impossible act; three
    // such rows exist in production. It must not drag the trade into an
    // earlier week than the one the work happened in.
    expect(journaledCloseAt(t({
      created_at: '2026-08-12T00:00:00.000Z',
      closed_at: '2026-08-05T00:00:00.000Z',
    }))).toBe(at('2026-08-12T00:00:00.000Z'))
  })

  it('returns null for a trade that is not closed', () => {
    expect(journaledCloseAt(t({ status: 'open', closed_at: null }))).toBeNull()
  })

  it('gives every closed trade exactly one instant, so no digest double-counts', () => {
    // The alternative considered was `traded_at in window OR created_at in
    // window`, which puts the back-logged trade above in BOTH the 08-05 and
    // the 08-12 week — the same trade reported in two consecutive reviews, in
    // the one email whose whole job is to be trustworthy about numbers.
    const back = t({
      traded_at: '2026-08-05T00:00:00.000Z',
      created_at: '2026-08-12T09:33:37.905Z',
      closed_at: '2026-08-12T09:33:37.905Z',
    })
    const inWeekEnding = (end: string) => {
      const ts = journaledCloseAt(back)!
      return ts >= at(end) - 7 * 864e5 && ts < at(end)
    }
    expect(inWeekEnding('2026-08-12T00:00:00.000Z')).toBe(false)
    expect(inWeekEnding('2026-08-19T00:00:00.000Z')).toBe(true)
  })
})
