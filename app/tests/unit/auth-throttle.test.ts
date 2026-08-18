import { describe, it, expect, vi, beforeEach } from 'vitest'

// `next/headers` only exists inside a request scope. The throttle reads exactly
// one header off it, so a stub is enough and lets the IP be varied per test.
let currentIp = '203.0.113.1'
vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (name: string) => (name === 'x-forwarded-for' ? currentIp : null),
  }),
}))

const { allowAuthAttempt, LOGIN_BUDGET, RESET_BUDGET } = await import('@/lib/server/auth-throttle')

/** Unique address per test so buckets from earlier tests cannot bleed in — the
 *  limiter's state is module-level by design and is not resettable. */
let n = 0
const freshEmail = () => `user${++n}-${Date.now()}@example.com`
const freshIp = () => `198.51.100.${(n % 250) + 1}`

beforeEach(() => { currentIp = freshIp() })

describe('allowAuthAttempt — per-email budget', () => {
  it(`allows exactly ${LOGIN_BUDGET.maxPerEmail} login attempts then refuses`, async () => {
    const email = freshEmail()
    for (let i = 0; i < LOGIN_BUDGET.maxPerEmail; i++) {
      expect(await allowAuthAttempt(LOGIN_BUDGET, email)).toBe(true)
    }
    expect(await allowAuthAttempt(LOGIN_BUDGET, email)).toBe(false)
  })

  it('keeps refusing once tripped, rather than letting every other attempt through', async () => {
    const email = freshEmail()
    for (let i = 0; i < LOGIN_BUDGET.maxPerEmail + 1; i++) await allowAuthAttempt(LOGIN_BUDGET, email)
    expect(await allowAuthAttempt(LOGIN_BUDGET, email)).toBe(false)
    expect(await allowAuthAttempt(LOGIN_BUDGET, email)).toBe(false)
  })

  it('normalises case and surrounding whitespace, so Alex@ and  alex@ share one bucket', async () => {
    const email = freshEmail()
    for (let i = 0; i < LOGIN_BUDGET.maxPerEmail; i++) {
      await allowAuthAttempt(LOGIN_BUDGET, ` ${email.toUpperCase()} `)
    }
    expect(await allowAuthAttempt(LOGIN_BUDGET, email)).toBe(false)
  })

  it('does not penalise a different address on the same IP', async () => {
    const a = freshEmail()
    for (let i = 0; i < LOGIN_BUDGET.maxPerEmail + 1; i++) await allowAuthAttempt(LOGIN_BUDGET, a)
    expect(await allowAuthAttempt(LOGIN_BUDGET, freshEmail())).toBe(true)
  })
})

describe('allowAuthAttempt — per-IP budget', () => {
  it('refuses once one host has burned the IP budget across many addresses', async () => {
    const ip = freshIp()
    currentIp = ip
    for (let i = 0; i < LOGIN_BUDGET.maxPerIp; i++) {
      expect(await allowAuthAttempt(LOGIN_BUDGET, freshEmail())).toBe(true)
    }
    expect(await allowAuthAttempt(LOGIN_BUDGET, freshEmail())).toBe(false)
  })

  it('consumes the IP bucket even while the email bucket is already refusing', async () => {
    // The non-short-circuit property: if tripping the email bucket skipped the
    // IP bucket, an attacker could park on one address to keep the IP budget
    // untouched and then switch addresses freely.
    const ip = freshIp()
    currentIp = ip
    const email = freshEmail()
    for (let i = 0; i < LOGIN_BUDGET.maxPerIp; i++) await allowAuthAttempt(LOGIN_BUDGET, email)
    // Email bucket tripped long ago; the IP budget should now be spent too.
    expect(await allowAuthAttempt(LOGIN_BUDGET, freshEmail())).toBe(false)
  })

  it('does not penalise a different IP', async () => {
    const email = freshEmail()
    currentIp = freshIp()
    for (let i = 0; i < LOGIN_BUDGET.maxPerIp + 1; i++) await allowAuthAttempt(LOGIN_BUDGET, freshEmail())
    currentIp = freshIp()
    expect(await allowAuthAttempt(LOGIN_BUDGET, email)).toBe(true)
  })
})

describe('budgets are scoped per action', () => {
  it('spending the reset budget does not lock the same address out of logging in', async () => {
    const email = freshEmail()
    for (let i = 0; i < RESET_BUDGET.maxPerEmail + 1; i++) await allowAuthAttempt(RESET_BUDGET, email)
    expect(await allowAuthAttempt(RESET_BUDGET, email)).toBe(false)
    expect(await allowAuthAttempt(LOGIN_BUDGET, email)).toBe(true)
  })

  it('reset requests are tighter than logins, because each one mails a stranger', () => {
    expect(RESET_BUDGET.maxPerEmail).toBeLessThan(LOGIN_BUDGET.maxPerEmail)
  })

  it('login allows enough attempts that a real user mistyping is never affected', () => {
    expect(LOGIN_BUDGET.maxPerEmail).toBeGreaterThanOrEqual(5)
  })
})

describe('degrades safely', () => {
  it('does not throw when the forwarded IP is absent', async () => {
    currentIp = ''
    await expect(allowAuthAttempt(LOGIN_BUDGET, freshEmail())).resolves.toBe(true)
  })
})
