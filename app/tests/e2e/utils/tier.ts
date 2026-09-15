import { createServiceClient } from './db'

/**
 * Give a test account a paid tier, without Stripe.
 *
 * ── WHY SPECS NEED THIS NOW ─────────────────────────────────────────────────
 *
 * Signing up used to hand every account a 14-day Pro trial automatically, so
 * every test user was Pro without asking. Feature specs quietly relied on that:
 * `journal` clicks "Detailed" (advanced_journal, Trader+), `leaderboard` fills
 * `risk_percent` (risk_tracking, Trader+), and so on. None of them said so.
 *
 * The trial now starts at Stripe Checkout, which a browser test cannot complete,
 * and /welcome offers a decline route — so a test user lands on Free and those
 * fields simply are not rendered. The specs did not break; the assumption under
 * them did.
 *
 * ── WHY comp_tier AND NOT A SUBSCRIPTION ────────────────────────────────────
 *
 * `comp_tier` is a single column that `resolveTier` already honours, so it
 * grants the tier with no Stripe object, no trial window, and no interaction
 * with any of the billing state a spec is not trying to exercise. A spec that
 * wants a real trialing subscription — trial.spec.ts, welcome-popup.spec.ts —
 * writes one itself, because for those the subscription IS the subject.
 *
 * Granting the tier explicitly is also better than inheriting it: a journal
 * test should not silently depend on trial mechanics, and when this is called
 * the spec says out loud which tier its feature needs.
 */
export async function grantTier(username: string, tier: 'trader' | 'pro' = 'pro'): Promise<void> {
  const { error } = await createServiceClient()
    .from('profiles')
    .update({ comp_tier: tier })
    .eq('username', username)
  if (error) throw new Error(`could not grant ${tier} to ${username}: ${error.message}`)
}
