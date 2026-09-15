// app/tests/unit/referral-payout-gate.test.ts
//
// What earns a referrer a free month, and what must not.
//
// The reward is counted on `activated` OR `paid` (getReferralStats), so which
// statuses a promotion will accept is not bookkeeping — it is the payout rule.
// A promotion that accepts `signed_up` does not merely skip a status, it pays
// the referrer A$50 for someone who signed up and did nothing.
//
// That was harmless while the only route to markReferralPaid was buying a plan.
// It stopped being harmless when every signup began opening a subscription.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { markReferralPaid, markReferralActivated } from '@/lib/server/referral'

const UID = '33333333-3333-4333-8333-333333333333'

type Row = Record<string, unknown>

/** A fake `referrals` table that applies the update's filters the way Postgres
 *  would: the row is only written when EVERY filter matches it. */
function fakeReferrals(status: string) {
  let row: Row = { status, referrer_id: 'ref_1' }
  const filters: [string, unknown][] = []

  const client = {
    from(_t: string) {
      return {
        update(values: Row) {
          const chain = {
            eq(col: string, val: unknown) { filters.push([col, val]); return chain },
            in(col: string, vals: unknown[]) { filters.push([col, vals]); return chain },
            select(_c: string) {
              return {
                maybeSingle: async () => {
                  const matches = filters.every(([c, v]) =>
                    c === 'referred_user_id'
                      ? v === UID
                      : Array.isArray(v) ? v.includes(row[c]) : row[c] === v)
                  if (!matches) return { data: null }
                  row = { ...row, ...values }
                  return { data: { referrer_id: row.referrer_id } }
                },
              }
            },
          }
          return chain
        },
      }
    },
  }
  return { client, filters, current: () => row }
}

describe('markReferralPaid — the payout gate', () => {
  it('promotes a referral that has ALREADY activated', () => {
    // The ordinary case: they logged a trade, then subscribed.
    const { client, current } = fakeReferrals('activated')
    return markReferralPaid(client as never, UID).then((referrer) => {
      expect(referrer).toBe('ref_1')
      expect(current().status).toBe('paid')
    })
  })

  it('REFUSES a referral that only signed up — the money test', () => {
    // Someone referred, who entered a card and never logged a trade. Promoting
    // this row would pay the referrer for a signup: A$50 a time, six per
    // referrer. They stay signed_up and earn nobody anything until they trade.
    const { client, current } = fakeReferrals('signed_up')
    return markReferralPaid(client as never, UID).then((referrer) => {
      expect(referrer).toBeNull()
      expect(current().status).toBe('signed_up')
    })
  })

  it('filters on exactly one status, so the gate cannot be widened by accident', () => {
    const { client, filters } = fakeReferrals('activated')
    return markReferralPaid(client as never, UID).then(() => {
      expect(filters).toContainEqual(['status', 'activated'])
      // An `in` filter is how signed_up used to get through. There must not be
      // one: a list is an invitation to add a value back to it.
      expect(filters.every(([, v]) => !Array.isArray(v))).toBe(true)
    })
  })

  it('does not re-promote a referral that is already paid', () => {
    const { client, current } = fakeReferrals('paid')
    return markReferralPaid(client as never, UID).then((referrer) => {
      expect(referrer).toBeNull()
      expect(current().status).toBe('paid')
    })
  })
})

describe('markReferralActivated is untouched — activation is still how a reward is earned', () => {
  it('promotes a signed_up referral when the referred user logs a trade', () => {
    const { client, current } = fakeReferrals('signed_up')
    return markReferralActivated(client as never, UID).then((referrer) => {
      expect(referrer).toBe('ref_1')
      expect(current().status).toBe('activated')
    })
  })

  it('does not reopen a paid referral', () => {
    const { client, current } = fakeReferrals('paid')
    return markReferralActivated(client as never, UID).then((referrer) => {
      expect(referrer).toBeNull()
      expect(current().status).toBe('paid')
    })
  })
})

describe('the webhook only reports a PAYING subscription', () => {
  const src = readFileSync(
    join(__dirname, '..', '..', 'src', 'app', 'api', 'stripe', 'webhook', 'route.ts'),
    'utf8',
  )

  it('calls markReferralPaid under an active-only condition', () => {
    // Defence in depth rather than the gate itself — markReferralPaid refuses a
    // non-activated row whatever the caller does. But a trial has taken no
    // money, so calling it "paid" is wrong on its own terms, and this is the
    // line that fired the instant a card was entered.
    const call = src.indexOf('markReferralPaid(svc, userId)')
    expect(call).toBeGreaterThan(-1)
    const preceding = src.slice(Math.max(0, call - 400), call)
    const guard = preceding.lastIndexOf('if (status ===')
    expect(guard).toBeGreaterThan(-1)
    expect(preceding.slice(guard)).toContain("if (status === 'active') {")
    expect(preceding.slice(guard)).not.toContain('trialing')
  })
})
