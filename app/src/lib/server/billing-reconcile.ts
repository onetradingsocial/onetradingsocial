import 'server-only'
import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  subscriptionRow, mirrorNeedsRepair, staleMirrorRows,
  type SubscriptionRow, type StaleMirrorRow,
} from '@/lib/billing-webhook'
import { resolveUserId } from '@/lib/server/billing'
import { raiseAlert } from '@/lib/server/alerts'
import { logError, logInfo } from '@/lib/server/log'

/**
 * Stripe → `public.subscriptions` reconciliation.
 *
 * WHY THIS EXISTS. Before WS1 the webhook was the single point of truth for
 * who is entitled to what, with no second signal of any kind: the entire
 * codebase made four Stripe API calls and not one of them read a subscription
 * back. A missed delivery, an unsubscribed event type or a wrong
 * STRIPE_WEBHOOK_SECRET produced no error anywhere — the mirror simply froze
 * and kept granting (or withholding) whatever it last recorded. In production
 * the one existing row had `updated_at` unmoved since creation with a billing
 * period a fortnight past, which is precisely what that failure looks like.
 *
 * This walks Stripe, which is authoritative, and repairs the mirror to match.
 *
 * TWO THINGS IT DELIBERATELY DOES NOT DO:
 *  1. It never writes a row that already matches. `subscriptions_touch_updated_at`
 *     fires on every UPDATE regardless of whether values changed, and
 *     `updated_at` is what the past_due grace window is measured from. A blind
 *     re-upsert would restart every grace clock on every run and hand a dunning
 *     account free access forever. mirrorNeedsRepair() is the gate.
 *  2. It never cancels a mirror row just because Stripe did not list it.
 *     Pagination truncation, a permissions error or an account mix-up would all
 *     look identical to "this subscription is gone", and the blast radius of
 *     getting it wrong is revoking a paying customer's access. Rows Stripe
 *     cannot account for raise an alert for a human instead.
 */

/** Bound on pages fetched, so a runaway account cannot blow the 60s cron
 *  budget. 100 subscriptions per page — 20 pages is 2,000 subscriptions, which
 *  is far beyond current scale and still leaves headroom. When the cap is hit
 *  the run is marked truncated and reports it. */
const MAX_PAGES = 20
const PAGE_SIZE = 100

export type ReconcileResult = {
  scanned: number
  repaired: number
  created: number
  unknownPrice: number
  unresolved: number
  stale: number
  truncated: boolean
  errors: string[]
}

export async function reconcileBilling(
  svc: SupabaseClient,
  stripe: Stripe,
  now: Date = new Date(),
): Promise<ReconcileResult> {
  const out: ReconcileResult = {
    scanned: 0, repaired: 0, created: 0, unknownPrice: 0,
    unresolved: 0, stale: 0, truncated: false, errors: [],
  }
  const env = process.env as Record<string, string | undefined>

  // Existing mirror, read once. Small table by construction (one row per
  // subscription ever created), so a full read is cheaper than N point reads.
  const { data: mirror, error: mirrorError } = await svc
    .from('subscriptions')
    .select('id, user_id, status, tier, price_id, current_period_end, cancel_at_period_end, updated_at')
  if (mirrorError) {
    out.errors.push(`mirror read failed: ${mirrorError.message}`)
    return out
  }
  const byId = new Map<string, NonNullable<typeof mirror>[number]>()
  for (const r of mirror ?? []) byId.set(r.id as string, r)

  const seen = new Set<string>()
  let startingAfter: string | undefined
  let pages = 0

  while (pages < MAX_PAGES) {
    pages++
    let page: Stripe.ApiList<Stripe.Subscription>
    try {
      page = await stripe.subscriptions.list({
        status: 'all', limit: PAGE_SIZE, ...(startingAfter ? { starting_after: startingAfter } : {}),
      })
    } catch (err) {
      out.errors.push(`stripe list failed: ${err instanceof Error ? err.message : String(err)}`)
      return out
    }

    for (const sub of page.data) {
      out.scanned++
      seen.add(sub.id)

      const next: SubscriptionRow | null = subscriptionRow(sub as never, env)
      if (!next) {
        out.unknownPrice++
        const priceId = sub.items?.data?.[0]?.price?.id ?? 'none'
        logError('billing reconcile', undefined, { note: 'unknown price sub', priceId, id: sub.id })
        continue
      }

      const existing = byId.get(sub.id)
      if (!mirrorNeedsRepair(existing ?? null, next)) continue

      // Resolving the user is the expensive step (a DB read, sometimes a Stripe
      // customer retrieve), so it happens only for rows that actually need a
      // write. An existing row already carries its user_id.
      let userId = existing?.user_id as string | null | undefined
      if (!userId) {
        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id
        userId = customerId ? await resolveUserId(svc, stripe, customerId) : null
      }
      if (!userId) {
        out.unresolved++
        logError('billing reconcile', undefined, { note: 'could not resolve user for sub', id: sub.id })
        continue
      }

      const { error } = await svc.from('subscriptions')
        .upsert({ ...next, user_id: userId }, { onConflict: 'id' })
      if (error) {
        out.errors.push(`upsert ${sub.id} failed: ${error.message}`)
        continue
      }
      if (existing) out.repaired++
      else out.created++
      logInfo('billing reconcile', { note: 'repaired', id: sub.id, transition: existing ? `${existing.status}->${next.status}` : 'created' })
    }

    if (!page.has_more) break
    startingAfter = page.data[page.data.length - 1]?.id
    if (!startingAfter) break
    if (pages === MAX_PAGES) out.truncated = true
  }

  // Anything Stripe never mentioned. Reported, never mutated — see the header.
  const orphans = (mirror ?? []).filter(
    (r) => !seen.has(r.id as string) && (r.status === 'active' || r.status === 'trialing'),
  )
  if (orphans.length > 0 && !out.truncated) {
    logError('billing reconcile', undefined, { note: 'mirror rows Stripe did not list', id: orphans.map((o) => o.id) })
    await raiseAlert(
      svc,
      'billing_orphan_mirror',
      `${orphans.length} subscription row(s) are marked active/trialing locally but were not returned by Stripe: ${orphans.map((o) => o.id).join(', ')}. Verify in Stripe before touching them.`,
      { count: orphans.length },
    )
  }

  // Rows Stripe DID confirm, but whose period lapsed and never renewed. After
  // the repair pass above this can no longer be explained by a missed webhook,
  // so it is real: either the subscription is dead in Stripe too, or the
  // reconciliation itself is not reaching the right account.
  //
  // Re-read rather than reusing `mirror`: that snapshot predates the repairs,
  // so a row this very run just renewed would otherwise be reported as stale.
  const { data: fresh } = await svc
    .from('subscriptions')
    .select('id, user_id, status, current_period_end')
  const staleRows = staleMirrorRows((fresh ?? []) as unknown as StaleMirrorRow[], now)
    .filter((r) => seen.has(r.id))
  out.stale = staleRows.length
  if (staleRows.length > 0) {
    await raiseAlert(
      svc,
      'billing_stale_period',
      `${staleRows.length} subscription(s) are marked active/trialing with a billing period that ended more than 48h ago: ${staleRows.map((r) => r.id).join(', ')}.`,
      { count: staleRows.length },
    )
  }

  return out
}
