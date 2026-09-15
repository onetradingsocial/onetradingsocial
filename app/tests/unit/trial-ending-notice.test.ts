import { describe, it, expect } from 'vitest'
import { trialEndingHtml } from '@/lib/server/email'

/**
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * `trialEndingHtml` used to be reachable only from the referral reward flow —
 * a handful of people, all of whom had deliberately claimed free months. Every
 * string in it was written for that case.
 *
 * Once the advertised trial runs on Stripe, `customer.subscription
 * .trial_will_end` fires on day 11 for EVERY signup and this becomes the
 * product's principal pre-charge notice: the last thing a customer is shown
 * before money leaves their account, and the document a chargeback or an ACCC
 * complaint would be argued from.
 *
 * So the tests below are not about wording. They pin the three things that
 * must be true of it on every branch, for every plan, in every interval:
 * the AMOUNT, the DATE, and the WAY OUT.
 */

const base = {
  name: 'Sam',
  amount: 'A$50',
  interval: 'month',
  endsOn: '29 September 2026',
  willCharge: true,
}

describe('the pre-charge notice names the amount, the date and the way out', () => {
  for (const kind of ['trial', 'reward'] as const) {
    it(`${kind}: names the amount and interval from Stripe`, () => {
      const html = trialEndingHtml({ ...base, kind })
      expect(html).toContain('A$50')
      expect(html).toContain('/month')
    })

    it(`${kind}: names the date`, () => {
      expect(trialEndingHtml({ ...base, kind })).toContain('29 September 2026')
    })

    it(`${kind}: names the way out, and says taking it costs nothing`, () => {
      const html = trialEndingHtml({ ...base, kind })
      expect(html).toMatch(/cancel before that date/i)
      expect(html).toMatch(/won't be charged anything/i)
      expect(html).toMatch(/Billing/)
    })
  }

  it('never falls back to naming a plan it cannot see', () => {
    // This fallback used to read "the standard Pro monthly price", which named
    // the wrong plan AND the wrong interval for a Trader or annual subscriber
    // every time the amount was missing — in the one email that exists to state
    // what will be taken.
    const html = trialEndingHtml({ ...base, amount: null, interval: null, kind: 'trial' })
    expect(html).not.toMatch(/standard Pro monthly price/i)
    expect(html).not.toMatch(/A\$/)
    expect(html).toMatch(/price shown on your billing page/i)
  })

  it('carries the AUD and GST position, since this is the figure that gets taken', () => {
    const html = trialEndingHtml({ ...base, kind: 'trial' })
    expect(html).toMatch(/Australian dollars \(AUD\)/)
    expect(html).toMatch(/No GST is charged/)
  })

  it('degrades to a phrase rather than printing a missing date', () => {
    const html = trialEndingHtml({ ...base, endsOn: null, kind: 'trial' })
    expect(html).toContain('shortly')
    expect(html).not.toMatch(/Invalid Date|undefined|null/)
  })
})

describe('kind changes the noun and nothing about the money', () => {
  it('describes a signup trial as a trial, not as free months', () => {
    const html = trialEndingHtml({ ...base, kind: 'trial' })
    expect(html).toMatch(/Your free trial is ending/)
    expect(html).not.toMatch(/free Pro months/)
    // A signup trialist never "claimed a reward" — that phrasing would make the
    // email read as though it were meant for someone else.
    expect(html).not.toMatch(/claimed the reward/)
    expect(html).toMatch(/the card on file/)
  })

  it('still describes referral months as months', () => {
    const html = trialEndingHtml({ ...base, kind: 'reward' })
    expect(html).toMatch(/Your free Pro months are ending/)
    expect(html).toMatch(/claimed the reward/)
  })

  it('defaults to the signup trial when kind is omitted', () => {
    // The commoner case, and the safer default: calling a signup trial "free
    // months" is confusing, while calling referral months "your free trial" is
    // merely imprecise.
    expect(trialEndingHtml(base)).toMatch(/Your free trial is ending/)
  })
})

describe('the no-card branch never asserts a charge', () => {
  const noCard = { ...base, willCharge: false }

  for (const kind of ['trial', 'reward'] as const) {
    it(`${kind}: says nothing will be charged, and does not name a price`, () => {
      const html = trialEndingHtml({ ...noCard, kind })
      expect(html).toMatch(/nothing will be charged/i)
      expect(html).toMatch(/add a card/i)
      // Naming an amount here would read as a bill to someone we cannot bill.
      expect(html).not.toContain('A$50')
    })
  }

  it('does not tell a Trader subscriber to keep "Pro"', () => {
    // Was "To keep Pro, add a card" regardless of the plan actually held.
    expect(trialEndingHtml({ ...noCard, kind: 'trial' })).toMatch(/keep your plan/i)
  })
})
