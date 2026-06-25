import { planForPrice, type PlanEnv, type Tier } from '@/lib/entitlements'

type StripeSubLike = {
  id: string
  status: string
  cancel_at_period_end: boolean
  items: { data: Array<{ price: { id: string }; current_period_end?: number | null }> }
}

export type SubscriptionRow = {
  id: string
  status: string
  tier: Tier
  price_id: string
  current_period_end: string | null
  cancel_at_period_end: boolean
}

/** Pure map from a Stripe subscription to a mirror row. Null when the price is
 *  not one of ours (caller should ack 200 and skip, not error). */
export function subscriptionRow(sub: StripeSubLike, env: PlanEnv): SubscriptionRow | null {
  const item = sub.items?.data?.[0]
  const priceId = item?.price?.id
  if (!priceId) return null
  const plan = planForPrice(priceId, env)
  if (!plan) return null
  return {
    id: sub.id,
    status: sub.status,
    tier: plan.tier,
    price_id: priceId,
    current_period_end: item?.current_period_end
      ? new Date(item.current_period_end * 1000).toISOString()
      : null,
    cancel_at_period_end: sub.cancel_at_period_end,
  }
}
