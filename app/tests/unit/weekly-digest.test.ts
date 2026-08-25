import { describe, it, expect } from 'vitest'
import { weeklyDigestHtml } from '@/lib/server/email'

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
