import { describe, it, expect } from 'vitest'
import { shouldShowWelcome } from '@/lib/entitlements'

describe('shouldShowWelcome', () => {
  it('shows for a new trialist who just finished onboarding', () => {
    expect(shouldShowWelcome(null, 'pro', 'active', false, true)).toBe(true)
  })

  it('does not show once that tier has been celebrated', () => {
    expect(shouldShowWelcome('pro', 'pro', 'active', false, true)).toBe(false)
  })

  it('shows for a new user with no trial', () => {
    expect(shouldShowWelcome(null, 'free', 'none', false, true)).toBe(true)
  })

  it('never shows while the end-of-trial wall is up', () => {
    expect(shouldShowWelcome('pro', 'free', 'expired', true, true)).toBe(false)
  })

  it('never celebrates the day-14 trial expiry drop', () => {
    expect(shouldShowWelcome('pro', 'free', 'expired', false, true)).toBe(false)
  })

  it('shows once the wall is answered and the user settled on Free', () => {
    expect(shouldShowWelcome('pro', 'free', 'resolved', false, true)).toBe(true)
  })

  it('shows once the wall is answered and the user subscribed', () => {
    expect(shouldShowWelcome('pro', 'trader', 'resolved', false, true)).toBe(true)
  })

  it('shows on an upgrade', () => {
    expect(shouldShowWelcome('free', 'trader', 'none', false, true)).toBe(true)
  })

  it('shows on churn back to free', () => {
    expect(shouldShowWelcome('pro', 'free', 'none', false, true)).toBe(true)
  })

  it('never shows before onboarding is completed', () => {
    // Otherwise it renders on top of /welcome and /onboarding, which the root
    // layout also wraps.
    expect(shouldShowWelcome(null, 'pro', 'active', false, false)).toBe(false)
  })

  it('shows a comp upgrade after an unresolved expiry (the bug the narrowing fixes)', () => {
    // TRIAL_WALL_ENABLED unset means trial_ack_at is only ever written by the
    // Stripe webhook, which never fires for a comp grant. Without the tier
    // === 'free' narrowing this stays suppressed forever.
    expect(shouldShowWelcome('free', 'pro', 'expired', false, true)).toBe(true)
  })

  it('shows an upgrade to trader after an unresolved expiry', () => {
    expect(shouldShowWelcome('free', 'trader', 'expired', false, true)).toBe(true)
  })
})
