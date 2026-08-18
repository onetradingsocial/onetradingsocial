import 'server-only'

import { createHash } from 'node:crypto'
import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { BUCKET, PRIVATE_BUCKET } from '@/lib/storage'
import { undeployAccount, removeAccount } from '@/lib/server/metaapi'
import {
  isUserOwnedKey, userStoragePrefixes, stripeCloseoutPlan,
  type BucketKind, type StepOutcome,
} from '@/lib/account-deletion'
import { logError } from '@/lib/server/log'

/**
 * The IO half of account deletion (item 6 F6.2-F6.6, F6.8). Ordering,
 * abort semantics and the Stripe/storage decisions live in
 * `lib/account-deletion.ts`; everything here is the call that actually
 * reaches out.
 *
 * Every function returns a StepOutcome rather than throwing, because the
 * orchestrator's contract is "a failed step stops the run with the account
 * intact" and an exception escaping to Next.js would instead render the
 * generic error page with no record of how far it got.
 *
 * IDEMPOTENCE IS A REQUIREMENT, NOT A NICETY. A user whose first attempt
 * aborted at storage will press the button again, and the Stripe and MetaApi
 * steps will run a second time against objects that are already gone. Each
 * step below therefore treats "already in the desired state" as success, and
 * says so where it is not obvious.
 */

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

export type DeletionContext = {
  userId: string
  email: string | null
  /** Handles that the auth.users delete will cascade away — read BEFORE it. */
  stripeCustomerId: string | null
  metaapiAccountId: string | null
  /** Every anon_id this browser/user pair has used. The handle on the
   *  pre-login analytics rows, which have no user_id to find them by. */
  anonIds: string[]
  /** Exchange API keys we cannot revoke for the user — surfaced in the UI and
   *  in the confirmation email so they know to revoke them at the exchange. */
  exchanges: string[]
}

/**
 * Every anon_id the account has ever been seen under.
 *
 * PAGED, not a single select, and that matters. PostgREST caps an unbounded
 * response at 1,000 rows; production already holds 2,836 analytics events
 * across a handful of accounts, so a single select would silently truncate for
 * any moderately active user. Because the anon_id is the ONLY handle on that
 * user's pre-login rows, a truncated read here means those rows are never
 * scrubbed and F6.5 is only half fixed — the exact failure this whole step
 * exists to close, reintroduced quietly.
 *
 * Ordered by id so the pages cannot overlap or skip, and capped so a
 * pathological account cannot spend the whole function budget in preflight.
 * The cap is deliberately generous: distinct anon_ids per person is a handful
 * (one per browser), and the loop exits as soon as a short page comes back.
 */
const ANON_PAGE = 1000
const ANON_MAX_PAGES = 50

async function collectAnonIds(svc: SupabaseClient, userId: string): Promise<string[]> {
  const found = new Set<string>()
  for (let page = 0; page < ANON_MAX_PAGES; page += 1) {
    const from = page * ANON_PAGE
    const { data, error } = await svc
      .from('analytics_events')
      .select('id, anon_id')
      .eq('user_id', userId)
      .not('anon_id', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + ANON_PAGE - 1)
    if (error) {
      // Not fatal to the preflight: the scrub still runs over the user_id
      // rows. Logged loudly because it means the anon rows were missed.
      logError('deletion', error.message, { note: 'anon_id enumeration failed', userId: userId })
      break
    }
    const rows = (data ?? []) as { anon_id: string | null }[]
    for (const r of rows) if (r.anon_id) found.add(r.anon_id)
    if (rows.length < ANON_PAGE) break
  }
  return [...found]
}

/**
 * Read every pointer we are about to destroy.
 *
 * This runs before any mutation, on the service client, because three of these
 * columns (stripe_customer_id in particular) are revoked from the client roles
 * by 0047 and because `analytics_events` is deny-all RLS.
 */
export async function collectDeletionContext(
  svc: SupabaseClient,
  userId: string,
  email: string | null,
): Promise<DeletionContext> {
  const [profile, broker, anonIds, exchanges] = await Promise.all([
    svc.from('profiles').select('stripe_customer_id').eq('id', userId).maybeSingle(),
    svc.from('broker_accounts').select('metaapi_account_id').eq('user_id', userId).maybeSingle(),
    collectAnonIds(svc, userId),
    svc.from('exchange_accounts').select('exchange').eq('user_id', userId),
  ])

  return {
    userId,
    email,
    stripeCustomerId: (profile.data as { stripe_customer_id?: string | null } | null)?.stripe_customer_id ?? null,
    metaapiAccountId: (broker.data as { metaapi_account_id?: string | null } | null)?.metaapi_account_id ?? null,
    anonIds,
    exchanges: ((exchanges.data ?? []) as { exchange: string }[]).map((r) => r.exchange),
  }
}

// ---------------------------------------------------------------------------
// Step 1 — Stripe (F6.3)
// ---------------------------------------------------------------------------

/** Stripe's "that object is not there" code. Every one of these means the step
 *  has already achieved what it set out to achieve. */
function isMissing(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code
  const status = (err as { statusCode?: number } | null)?.statusCode
  return code === 'resource_missing' || status === 404
}

/**
 * Cancel the subscription immediately, take the card away, and then either
 * delete the customer (no billing history) or keep it as the tax record
 * (any billing history) — see stripeCloseoutPlan for why that split exists.
 *
 * `prorate: false` is load-bearing: it is the difference between "cancel" and
 * "cancel and issue a credit note for the unused days". Terms §11 says we do
 * not refund a part-period the user chose to walk away from, so requesting a
 * proration here would have the code quietly giving away something the
 * contract does not, on a path nobody watches.
 *
 * Detaching payment methods matters independently of the cancellation. It is
 * the belt to the cancellation's braces: even if a subscription were somehow
 * missed — a second one created out of band, a webhook that reinstated
 * something — there is no longer an instrument on file to charge.
 */
export async function closeStripeForDeletion(
  stripe: Stripe,
  customerId: string,
): Promise<StepOutcome> {
  try {
    const subs = await stripe.subscriptions.list({
      customer: customerId, status: 'all', limit: 100,
    })

    // "Has this customer ever transacted?" One invoice or one charge is
    // enough; we only need to know whether a record exists, not how many.
    const [invoices, charges] = await Promise.all([
      stripe.invoices.list({ customer: customerId, limit: 1 }),
      stripe.charges.list({ customer: customerId, limit: 1 }),
    ])
    const hasBillingHistory = invoices.data.length > 0 || charges.data.length > 0

    const plan = stripeCloseoutPlan({
      subscriptions: subs.data.map((s) => ({ id: s.id, status: s.status })),
      hasBillingHistory,
    })

    for (const id of plan.cancel) {
      try {
        await stripe.subscriptions.cancel(id, { prorate: false })
      } catch (err) {
        // Already cancelled by the portal, by Stripe's dunning, or by a
        // previous attempt at this same deletion. Not a failure.
        if (!isMissing(err)) throw err
      }
    }

    let detached = 0
    const methods = await stripe.paymentMethods.list({ customer: customerId, limit: 100 })
    for (const pm of methods.data) {
      try {
        await stripe.paymentMethods.detach(pm.id)
        detached += 1
      } catch (err) {
        if (!isMissing(err)) throw err
      }
    }

    if (plan.deleteCustomer) {
      try {
        await stripe.customers.del(customerId)
      } catch (err) {
        if (!isMissing(err)) throw err
      }
    } else {
      // Kept for the statutory record. The metadata is so that a human
      // reading the Stripe dashboard in two years understands why a customer
      // with no corresponding TradingSocial account is still there, rather
      // than "tidying it up" and destroying the tax linkage.
      try {
        await stripe.customers.update(customerId, {
          metadata: {
            ts_account_deleted: 'true',
            ts_account_deleted_at: new Date().toISOString(),
            ts_retention: 'invoice history retained for AU tax record-keeping (ITAA 1936 s262A)',
          },
        })
      } catch (err) {
        if (!isMissing(err)) throw err
      }
    }

    return {
      ok: true,
      detail: {
        cancelled: plan.cancel.length,
        detached,
        customer: plan.deleteCustomer ? 'deleted' : 'retained_for_tax_record',
      },
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'stripe call failed'
    logError('deletion', message, { note: 'stripe closeout failed', customerId: customerId })
    return { ok: false, error: message }
  }
}

// ---------------------------------------------------------------------------
// Step 2 — MetaApi (F6.4)
// ---------------------------------------------------------------------------

/**
 * Undeploy then remove, mirroring disconnectBroker (actions/broker.ts:57-58)
 * exactly — the correct code already existed, it was simply never called from
 * here.
 *
 * ONE DELIBERATE DIFFERENCE from disconnectBroker: there, both calls are
 * best-effort and the local row is deleted regardless. Here a failure ABORTS.
 * What is at the other end is the user's MT5 investor password, sitting at a
 * third-party processor after the user has asked us to delete everything, and
 * the local row we are about to delete holds the only id that can find it
 * again. Proceeding past a failure would make it permanently unreachable.
 *
 * The undeploy is still best-effort: an account that will not undeploy can
 * usually still be removed, and MetaApi returns an error for undeploying
 * something that was never deployed.
 */
export async function removeMetaApiForDeletion(accountId: string): Promise<StepOutcome> {
  const undeploy = await undeployAccount(accountId)
  const removal = await removeAccount(accountId)
  if ('error' in removal) {
    // A DELETE against an account that is already gone is the desired end
    // state, not a failure — a retry after an earlier abort lands here.
    if (/not found|404/i.test(removal.error)) {
      return { ok: true, detail: { removed: 'already_absent' } }
    }
    logError('deletion', removal.error, { note: 'metaapi remove failed', accountId: accountId })
    return { ok: false, error: removal.error }
  }
  return {
    ok: true,
    detail: { removed: true, undeployed: !('error' in undeploy) },
  }
}

// ---------------------------------------------------------------------------
// Step 3 — Storage, both buckets (F6.2)
// ---------------------------------------------------------------------------

const LIST_PAGE = 1000
const REMOVE_BATCH = 100
/** posts/{uid}/{postId}/{n}.png and messages/{uid}/{draftId}/{n}.png are the
 *  deepest shapes in either bucket. The cap stops a malformed listing response
 *  turning the walk into an unbounded recursion inside a 60s function. */
const MAX_DEPTH = 4

type StorageClient = Pick<SupabaseClient, 'storage'>

/**
 * Enumerate every object under a folder. Supabase's `list` is one level deep
 * and returns folders as entries with a null `id`, so the recursion is ours to
 * write; there is no server-side recursive list.
 */
async function listFolder(
  svc: StorageClient, bucket: string, prefix: string, out: string[], depth = 0,
): Promise<void> {
  if (depth > MAX_DEPTH) return
  let offset = 0
  for (;;) {
    const { data, error } = await svc.storage
      .from(bucket).list(prefix, { limit: LIST_PAGE, offset })
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`)
    const entries = data ?? []
    for (const entry of entries) {
      const full = prefix ? `${prefix}/${entry.name}` : entry.name
      // A null id is Supabase's marker for a synthetic folder row rather than
      // a real object. `.placeholder` is the empty-folder sentinel the storage
      // API creates and then hides; it is a real object and must be removed
      // too or the folder is never actually empty.
      if (entry.id === null) await listFolder(svc, bucket, full, out, depth + 1)
      else out.push(full)
    }
    if (entries.length < LIST_PAGE) return
    offset += LIST_PAGE
  }
}

/**
 * Match `avatars/{uid}.png` inside a folder shared by every user on the
 * platform. `search` is a server-side filter on the object name, so this does
 * not pull the whole avatars folder down — but the result is still filtered
 * locally, because `search` is a substring match and a uuid appearing anywhere
 * in another user's filename would otherwise qualify.
 */
async function listByFilename(
  svc: StorageClient, bucket: string, prefix: string, userId: string, out: string[],
): Promise<void> {
  const { data, error } = await svc.storage
    .from(bucket).list(prefix, { limit: LIST_PAGE, search: userId })
  if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`)
  for (const entry of data ?? []) {
    if (entry.id === null) continue
    out.push(`${prefix}/${entry.name}`)
  }
}

/**
 * Delete every object the user owns, from both buckets.
 *
 * Raw `DELETE FROM storage.objects` is not an option: the
 * `protect_objects_delete` trigger raises 42501 ("Direct deletion from storage
 * tables is not allowed"), so this must go through the Storage API. That is
 * also why this step cannot be folded into the migration.
 *
 * Every candidate path is re-checked with isUserOwnedKey before it is passed
 * to `.remove()`. That check is redundant with the enumeration by design —
 * `avatars/` and `covers/` are shared folders, and a listing bug there would
 * otherwise delete the platform's avatars rather than one user's.
 */
export async function purgeUserStorage(
  svc: StorageClient, userId: string,
): Promise<StepOutcome> {
  const bucketName = (kind: BucketKind) => (kind === 'private' ? PRIVATE_BUCKET : BUCKET)
  try {
    const byBucket = new Map<string, string[]>()

    for (const spec of userStoragePrefixes()) {
      const bucket = bucketName(spec.bucket)
      const found: string[] = []
      if (spec.match === 'filename') {
        await listByFilename(svc, bucket, spec.prefix, userId, found)
      } else {
        await listFolder(svc, bucket, `${spec.prefix}/${userId}`, found)
      }
      const owned = found.filter((key) => isUserOwnedKey(key, userId))
      const rejected = found.length - owned.length
      if (rejected > 0) {
        // Never silent. A non-zero count here means the enumeration produced a
        // path outside the user's namespace, which is a bug worth seeing even
        // though the guard already stopped it being acted on.
        logError('deletion', undefined, {
          note: 'storage enumeration produced foreign keys', bucket, prefix: spec.prefix, rejected,
        })
      }
      if (owned.length) byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), ...owned])
    }

    let removed = 0
    for (const [bucket, keys] of byBucket) {
      for (let i = 0; i < keys.length; i += REMOVE_BATCH) {
        const batch = keys.slice(i, i + REMOVE_BATCH)
        const { error } = await svc.storage.from(bucket).remove(batch)
        if (error) throw new Error(`remove ${bucket}: ${error.message}`)
        removed += batch.length
      }
    }

    // Zero objects is a perfectly normal outcome — most accounts never upload
    // anything — so it is success, not a suspicious result.
    return { ok: true, detail: { removed, buckets: [...byBucket.keys()] } }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'storage purge failed'
    logError('deletion', message, { note: 'storage purge failed', userId: userId })
    return { ok: false, error: message }
  }
}

// ---------------------------------------------------------------------------
// Step 4 — Analytics de-identification (F6.5)
// ---------------------------------------------------------------------------

/**
 * Make the surviving analytics rows genuinely aggregate rather than merely
 * detached.
 *
 * `analytics_events_user_id_fkey` is ON DELETE SET NULL, so the cascade
 * already nulls user_id — and that is precisely the problem F6.5 names:
 * nulling a foreign key is not de-identification while a stable pseudonymous
 * key sits in the same row. `anon_id` is a client-generated identifier that
 * persists across sessions, so the "anonymised" rows remain trivially
 * re-associated with each other and with the same browser.
 *
 * Three columns go, and each for its own reason:
 *   anon_id   — the re-linking key itself.
 *   path      — routes include `/{username}`, so a path is often a name.
 *   referrer  — carries query strings and off-site identifiers we never chose.
 *
 * What is KEPT is deliberate and is the legitimate-retention half of item 6
 * Part 3: event, device, source, created_at. With no anon_id the rows can no
 * longer be joined to each other, so what remains is a count of an event on a
 * device from a campaign on a date — genuinely aggregate, outside the Privacy
 * Act, and enough to keep the funnel history honest.
 *
 * The scrub runs over TWO sets, and missing the second was the original bug:
 * rows where user_id = uid, and rows sharing any of that user's anon_ids —
 * which is how the PRE-SIGNUP events are reached. Those never had a user_id,
 * so no cascade and no foreign key could ever have found them, and they are
 * the ones that record the visit that led to the account.
 *
 * referral_clicks gets the same treatment in the same pass: no FK, keyed by
 * code + anon_id, so it is the same identifier hiding in a second table.
 */
export async function scrubAnalytics(
  svc: SupabaseClient, userId: string, anonIds: readonly string[],
): Promise<StepOutcome> {
  try {
    const scrub = { user_id: null, anon_id: null, path: null, referrer: null }

    const byUser = await svc.from('analytics_events').update(scrub).eq('user_id', userId)
    if (byUser.error) throw new Error(`analytics by user: ${byUser.error.message}`)

    if (anonIds.length) {
      const byAnon = await svc.from('analytics_events').update(scrub).in('anon_id', [...anonIds])
      if (byAnon.error) throw new Error(`analytics by anon: ${byAnon.error.message}`)

      const clicks = await svc
        .from('referral_clicks').update({ anon_id: null }).in('anon_id', [...anonIds])
      // referral_clicks is a P3 nicety riding along, not the point of this
      // step. Its failure is logged and does not abort a deletion.
      if (clicks.error) logError('deletion', clicks.error.message, { note: 'referral_clicks scrub failed' })
    }

    return { ok: true, detail: { anonIds: anonIds.length } }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'analytics scrub failed'
    logError('deletion', message, { note: 'analytics scrub failed', userId: userId })
    return { ok: false, error: message }
  }
}

// ---------------------------------------------------------------------------
// Step 5 — Moderation retention (F6.8)
// ---------------------------------------------------------------------------

/** PostgREST's code for "no such column". */
const UNDEFINED_COLUMN = '42703'

/**
 * Stamp a salted hash of the email onto any report filed against this account,
 * so the moderation record survives the erasure without retaining an
 * identifier. Migration 0051 flips `trade_reports.reported_user_id` from
 * CASCADE to SET NULL; this is what stops the surviving row being anonymous to
 * the point of uselessness.
 *
 * The email, not the user id — see 0051 §2. A hash of the uuid could never
 * match a re-registration, because re-registration mints a new uuid; the email
 * is the identity that persists, which is the whole point of the retention.
 *
 * INERT WITHOUT THE MIGRATION, ON PURPOSE. Deploy order is code first,
 * migration second, and until it lands `reported_user_hash` does not exist:
 * PostgREST answers 42703 and this returns ok with `skipped`. It must not
 * abort — the entire deletion failing because a P2 moderation nicety is a
 * deploy ahead of its schema would be a far worse outcome than a report that
 * cascades away exactly as it does today.
 *
 * With no salt configured the hash is skipped and logged rather than computed
 * unsalted. An unsalted SHA-256 of an email is a lookup, not a pseudonym, and
 * writing one into a table would create the exposure this column exists to
 * avoid. The report row still survives either way.
 */
export async function preserveModerationRecords(
  svc: SupabaseClient, userId: string, email: string | null,
): Promise<StepOutcome> {
  const salt = process.env.DELETION_HASH_SALT
  if (!email) return { ok: true, detail: { skipped: 'no_email' } }
  if (!salt) {
    logError('deletion', undefined, { note: 'DELETION_HASH_SALT unset — moderation reports keep no pseudonym' })
    return { ok: true, detail: { skipped: 'no_salt' } }
  }
  try {
    const hash = createHash('sha256').update(`${salt}:${email.trim().toLowerCase()}`).digest('hex')
    const { error, count } = await svc
      .from('trade_reports')
      .update({ reported_user_hash: hash }, { count: 'exact' })
      .eq('reported_user_id', userId)
    if (error) {
      if (error.code === UNDEFINED_COLUMN) {
        return { ok: true, detail: { skipped: 'no_hash_column' } }
      }
      throw new Error(error.message)
    }
    return { ok: true, detail: { stamped: count ?? 0 } }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'moderation stamp failed'
    logError('deletion', message, { note: 'moderation stamp failed', userId: userId })
    return { ok: false, error: message }
  }
}

/**
 * Audit item 18, F7 — the admin's own erasure right over the audit log.
 *
 * `admin_audit.actor_id` is `on delete set null` but `actor_email` was
 * denormalised specifically to survive profile deletion (`0034:7-9`), so an
 * admin who exercises their own erasure right leaves their address in the log
 * forever. The tension is real: audit integrity needs attribution, erasure
 * needs removal.
 *
 * **Resolved with WS3's pattern rather than a second one.** This is the exact
 * mechanism `preserveModerationRecords` uses for `trade_reports` — same salted
 * SHA-256, same salt, same input (the normalised email, not the uuid) — so the
 * same departed person gets the same pseudonym in both tables and there is one
 * pseudonymisation rule in this codebase, not two. The record survives with
 * stable attribution: two rows from the same departed admin still read as the
 * same actor, and nothing in the row is their address.
 *
 * Why the email and not the uuid, again: `actor_id` is about to be nulled by
 * the cascade, so a uuid hash would be a pseudonym for a value that no longer
 * appears anywhere and could never be matched to anything. The email is the
 * identity that persists across a re-registration, which is what makes the
 * pseudonym worth keeping at all.
 *
 * **Non-fatal on purpose.** Unlike the moderation stamp this is housekeeping on
 * *our* records, not a retention obligation, and a failure here must not strand
 * a user mid-deletion. It logs and reports, it does not abort. Same standing as
 * the `referral_clicks` scrub.
 *
 * Runs BEFORE the auth delete — afterwards `actor_id` is null and there is no
 * way left to find the rows.
 */
export async function pseudonymiseAdminAudit(
  svc: SupabaseClient, userId: string, email: string | null,
  // The `ok: true` in the return type is the non-fatal contract, stated where
  // the compiler enforces it: this function has no failure branch that can
  // abort a deletion, and it must not grow one.
): Promise<{ ok: true; detail?: Record<string, unknown> }> {
  const salt = process.env.DELETION_HASH_SALT
  if (!email) return { ok: true, detail: { skipped: 'no_email' } }
  if (!salt) {
    logError('deletion', undefined, { note: 'DELETION_HASH_SALT unset — admin_audit keeps the actor email' })
    return { ok: true, detail: { skipped: 'no_salt' } }
  }
  try {
    const hash = createHash('sha256').update(`${salt}:${email.trim().toLowerCase()}`).digest('hex')
    const { error, count } = await svc
      .from('admin_audit')
      .update({ actor_email: null, actor_email_hash: hash }, { count: 'exact' })
      .eq('actor_id', userId)
      .not('actor_email', 'is', null)
    if (error) {
      if (error.code === UNDEFINED_COLUMN) return { ok: true, detail: { skipped: 'no_hash_column' } }
      throw new Error(error.message)
    }
    return { ok: true, detail: { pseudonymised: count ?? 0 } }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'admin_audit pseudonymisation failed'
    logError('deletion', message, { note: 'admin_audit pseudonymisation failed', userId: userId })
    return { ok: true, detail: { failed: message } }
  }
}

// ---------------------------------------------------------------------------
// Step 6 — the local delete (unchanged, and it was already right)
// ---------------------------------------------------------------------------

/**
 * The one call that was always correct. `admin.deleteUser` with no second
 * argument means `shouldSoftDelete` is false, so auth.users is HARD deleted,
 * profiles_id_fkey cascades the public graph, and the email address is
 * genuinely released for re-signup. Do not add a second argument.
 */
export async function hardDeleteAuthUser(
  svc: SupabaseClient, userId: string,
): Promise<StepOutcome> {
  const { error } = await svc.auth.admin.deleteUser(userId)
  if (error) {
    logError('deletion', error.message, { note: 'admin.deleteUser failed', userId: userId })
    return { ok: false, error: error.message }
  }
  return { ok: true }
}
