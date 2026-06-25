import 'server-only'
import Stripe from 'stripe'

let _stripe: Stripe | null = null

/** Lazy server-only Stripe client. API version omitted -> uses the account
 *  default pinned in the Stripe dashboard. */
export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set')
    _stripe = new Stripe(key)
  }
  return _stripe
}
