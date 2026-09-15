import { describe, it, expect } from 'vitest'
import {
  activeTrialWindow, stripeTrialWindow, localTrialWindow,
  willCharge, windowDaysLeft, windowDaysElapsed,
  type TrialSubRow,
} from '@/lib/trial-window'
import { trialSequenceHtml } from '@/lib/server/email'
import { TRIAL_DAYS } from '@/lib/entitlements'

const DAY = 864e5
const NOW = new Date('2026-09-15T00:00:00.000Z')
const iso = (msFromNow: number) => new Date(NOW.getTime() + msFromNow).toISOString()

const trialing = (over: Partial<TrialSubRow> = {}): TrialSubRow => ({
  status: 'trialing',
  trial_start: iso(-4 * DAY),
  trial_end: iso(10 * DAY),
  cancel_at_period_end: false,
  ...over,
})

describe('stripeTrialWindow', () => {
  it('reads the mirrored trial window', () => {
    const w = stripeTrialWindow([trialing()])!
    expect(w.source).toBe('stripe')
    expect(w.cardOnFile).toBe(true)
    expect(w.endsAt).toBe(NOW.getTime() + 10 * DAY)
  })

  it('ignores a subscription that is not trialing', () => {
    for (const status of ['active', 'past_due', 'canceled', 'incomplete', 'unpaid', 'paused']) {
      expect(stripeTrialWindow([trialing({ status })])).toBeNull()
    }
  })

  it('FAILS CLOSED on a row mirrored before 0076, rather than inventing day NaN', () => {
    // A row written before trial_end existed has null trial columns. Treating
    // that as a window gives every figure NaN, and dueTrialStage answers NaN
    // with null — so it would look exactly like "no email due today" instead of
    // like a bug, and the whole Stripe cohort would go quiet with a green cron.
    expect(stripeTrialWindow([trialing({ trial_end: null })])).toBeNull()
    expect(stripeTrialWindow([trialing({ trial_end: 'not a date' })])).toBeNull()
  })

  it('back-computes a missing trial_start rather than dropping the window', () => {
    // Losing the window would mean losing the charge disclosure. Losing the
    // start only shifts which nudge is due.
    const w = stripeTrialWindow([trialing({ trial_start: null })])!
    expect(w.endsAt - w.startedAt).toBe(TRIAL_DAYS * DAY)
    expect(w.cardOnFile).toBe(true)
  })

  it('is null for no rows at all', () => {
    expect(stripeTrialWindow([])).toBeNull()
    expect(stripeTrialWindow(null)).toBeNull()
    expect(stripeTrialWindow(undefined)).toBeNull()
  })
})

describe('localTrialWindow', () => {
  it('is a card-free window while the trial is active', () => {
    const w = localTrialWindow(iso(-3 * DAY), null, NOW)!
    expect(w.source).toBe('local')
    expect(w.cardOnFile).toBe(false)
    expect(w.endsAt).toBe(NOW.getTime() + 11 * DAY)
  })

  it('is null once expired, acked, or never started', () => {
    expect(localTrialWindow(iso(-20 * DAY), null, NOW)).toBeNull()   // expired
    expect(localTrialWindow(iso(-3 * DAY), iso(-1 * DAY), NOW)).toBeNull() // acked
    expect(localTrialWindow(null, null, NOW)).toBeNull()
  })
})

describe('activeTrialWindow — which trial describes this user', () => {
  const local = { trial_started_at: iso(-3 * DAY), trial_ack_at: null }

  it('prefers STRIPE when both are running — the safety ordering', () => {
    // A grandfathered user who takes the add-a-card invitation holds both. The
    // Stripe one ends in a charge, so it is the one every message must describe.
    // Choosing the local one would mail them "nothing will be charged".
    const w = activeTrialWindow(local, [trialing()], NOW)!
    expect(w.source).toBe('stripe')
    expect(w.cardOnFile).toBe(true)
  })

  it('prefers Stripe even when the LOCAL trial ends later', () => {
    // Safety ordering, not recency: a longer card-free window must not mask a
    // shorter one that ends in a charge.
    const w = activeTrialWindow(
      { trial_started_at: iso(-1 * DAY), trial_ack_at: null },
      [trialing({ trial_end: iso(2 * DAY) })],
      NOW,
    )!
    expect(w.source).toBe('stripe')
  })

  it('falls back to the local trial when there is no Stripe one', () => {
    expect(activeTrialWindow(local, [], NOW)!.source).toBe('local')
  })

  it('falls back to local when the Stripe trial has already ended', () => {
    const w = activeTrialWindow(local, [trialing({ trial_end: iso(-1 * DAY) })], NOW)!
    expect(w.source).toBe('local')
  })

  it('is null when neither is running — never "day 0 of something"', () => {
    expect(activeTrialWindow({ trial_started_at: null, trial_ack_at: null }, [], NOW)).toBeNull()
  })
})

describe('willCharge', () => {
  it('is true for a Stripe trial that is not set to cancel', () => {
    expect(willCharge(stripeTrialWindow([trialing()])!)).toBe(true)
  })
  it('is false once the user has cancelled — the trial simply lapses', () => {
    expect(willCharge(stripeTrialWindow([trialing({ cancel_at_period_end: true })])!)).toBe(false)
  })
  it('is never true for a card-free local trial', () => {
    expect(willCharge(localTrialWindow(iso(-3 * DAY), null, NOW)!)).toBe(false)
  })
})

describe('day arithmetic', () => {
  it('counts days left up, and days elapsed down', () => {
    const w = stripeTrialWindow([trialing()])!
    expect(windowDaysLeft(w, NOW)).toBe(10)
    expect(windowDaysElapsed(w, NOW)).toBe(4)
  })
  it('floors days left at zero rather than going negative', () => {
    const w = localTrialWindow(iso(-3 * DAY), null, NOW)!
    expect(windowDaysLeft(w, new Date(NOW.getTime() + 30 * DAY))).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// The copy this all exists to get right
// ---------------------------------------------------------------------------

describe('trialSequenceHtml never promises a card-on-file user they cannot be charged', () => {
  const base = { name: 'Sam', daysLeft: 3, trades: 2, hasBroker: false, canAutosync: false, kept: 30 }

  /**
   * The UNCONDITIONAL denials — each one asserts, flatly, that a charge cannot
   * happen. If one of these reaches a user with a card on file, we have told
   * them in writing that we will not charge them, days before we do.
   *
   * Deliberately NOT a loose /will not be charged/ match. The card-on-file copy
   * has to contain that phrase, in its CONDITIONAL form: "cancel before then in
   * Settings → Billing and you will not be charged." That sentence is the whole
   * point of the email — it is how the user avoids the charge — and a test blunt
   * enough to ban it would push the copy toward saying less about how to get
   * out, which is the opposite of what this is for. The distinction being
   * tested is "a charge is impossible" versus "here is how to prevent it".
   */
  const DENIALS = [
    /<b>You will not be charged\.<\/b>/,
    /Nothing will be charged at any point/i,
    /No card was taken/i,
    /Still no card on file/i,
    /never asked for a card/i,
    /there is nothing to cancel/i,
  ]

  for (const stage of [1, 7, 12] as const) {
    it(`stage ${stage}: card-free copy keeps the reassurance`, () => {
      const html = trialSequenceHtml({ ...base, stage, cardOnFile: false })
      expect(DENIALS.some((d) => d.test(html))).toBe(true)
    })

    it(`stage ${stage}: card-on-file copy contains NO denial of a charge`, () => {
      const html = trialSequenceHtml({ ...base, stage, cardOnFile: true, endsOn: '29 September 2026' })
      for (const d of DENIALS) expect(html).not.toMatch(d)
    })

    it(`stage ${stage}: card-on-file copy names the date and the way out`, () => {
      const html = trialSequenceHtml({ ...base, stage, cardOnFile: true, endsOn: '29 September 2026' })
      expect(html).toContain('29 September 2026')
      expect(html).toMatch(/cancel/i)
      expect(html).toMatch(/Billing/)
    })

    it(`stage ${stage}: card-on-file copy keeps the CONDITIONAL "and you will not be charged"`, () => {
      // The counterpart to the DENIALS check above, and the reason that list is
      // written tightly. Telling someone a charge is coming without telling them
      // how to stop it is not an improvement on telling them it is not coming.
      const html = trialSequenceHtml({ ...base, stage, cardOnFile: true, endsOn: '29 September 2026' })
      expect(html).toMatch(/cancel[^.]*you will not be charged/i)
    })
  }

  it('degrades to a phrase rather than printing a missing date', () => {
    const html = trialSequenceHtml({ ...base, stage: 1, cardOnFile: true, endsOn: null })
    expect(html).toContain('when your trial ends')
    expect(html).not.toMatch(/Invalid Date|undefined|null/)
  })

  it('defaults to the card-free copy when the flag is omitted', () => {
    // Every existing caller predates the flag. Omitting it must mean "the old
    // card-free trial", which is what those callers are actually describing.
    const html = trialSequenceHtml({ ...base, stage: 1 })
    expect(DENIALS.some((d) => d.test(html))).toBe(true)
  })
})
