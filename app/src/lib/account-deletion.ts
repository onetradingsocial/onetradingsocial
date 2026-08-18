/**
 * Account deletion — the parts with no IO in them.
 *
 * Same split as billing: the decisions live here so they are unit-testable
 * without mocking Stripe, MetaApi, Supabase Storage and PostgREST all at once
 * (`lib/billing-webhook.ts` pure / `lib/server/billing.ts` IO). The IO half is
 * `lib/server/account-deletion.ts`.
 *
 * Audit item 6, findings F6.1-F6.6, F6.8, F6.9, F6.12.
 */

// ---------------------------------------------------------------------------
// Ordering — read this before changing it
// ---------------------------------------------------------------------------
//
// Deletion now spans four systems that can each fail independently: Stripe,
// MetaApi, Supabase Storage and Postgres. There is no distributed transaction
// available and there is not going to be one, so the ordering IS the
// correctness argument. Two rules produce it:
//
//   RULE 1 — never destroy a pointer before you have used it.
//     `profiles.stripe_customer_id` and `broker_accounts.metaapi_account_id`
//     are the only handles we hold on the Stripe customer and the MetaApi
//     account, and both are cascade-deleted by the auth.users delete. Calling
//     the external services AFTER the local delete is not "later", it is
//     never: the ids are gone and the subscription bills a person who no
//     longer exists (F6.3). The same argument applies to storage, where the DB
//     rows are the only index of which objects exist, and to analytics, where
//     `user_id` is SET NULL on cascade and takes the handle with it (F6.5).
//
//   RULE 2 — order the steps so that an abort leaves the LEAST bad state.
//     Every step before `auth` is reversible-by-retry or harmless to repeat;
//     `auth` is the point of no return and therefore goes last. Within the
//     external steps, Stripe is first because it is the only one whose failure
//     costs the user money, and finding out it failed while the account is
//     still intact means they can retry or reach support. Storage is last of
//     the external steps because it is the most likely to fail partway and the
//     most forgiving: the DB still names every object, so a retry re-enumerates
//     from scratch.
//
// The residual half-states, stated rather than hidden:
//
//   * Stripe cancelled, later step failed -> the subscription is cancelled but
//     the account survives. This is the user's own intent (they asked to
//     delete), it is idempotent on retry, and the alternative -- cancelling
//     last -- risks never cancelling at all. Accepted, logged, and named in
//     the error the user sees.
//   * Analytics scrubbed / moderation stamped, auth delete failed -> the
//     account survives with de-identified analytics. Also the user's intent,
//     also idempotent. Accepted.
//
// What is NOT accepted, and what the ordering exists to prevent, is the
// mirror image: the account gone while Stripe still bills it.

export const DELETION_ORDER = [
  'stripe',
  'metaapi',
  'storage',
  'analytics',
  'moderation',
  'auth',
] as const

export type DeletionStep = (typeof DELETION_ORDER)[number]

export type StepOutcome =
  | { ok: true; detail?: Record<string, unknown> }
  | { ok: false; error: string }

export type StepResult = {
  step: DeletionStep
  ok: boolean
  detail?: Record<string, unknown>
  error?: string
}

export type DeletionRun = {
  ok: boolean
  results: StepResult[]
  /** The step that aborted the run; undefined when every step succeeded. */
  failedAt?: DeletionStep
}

/**
 * Run the steps in order and stop at the first failure.
 *
 * Fail-fast rather than best-effort, and that is deliberate. "Try everything
 * and report what broke" sounds more robust but produces exactly the outcome
 * item 6 warns about: an account that is neither deleted nor intact, with no
 * single place that says which. Stopping means the state after an abort is
 * always "steps 1..n-1 done, account still usable, retry is safe".
 *
 * A step that throws is treated as a failure, not as a crash: an unhandled
 * rejection here would surface to the user as the generic Next.js error page
 * with no indication of how far the deletion got.
 */
export async function runDeletionSteps(
  steps: Partial<Record<DeletionStep, () => Promise<StepOutcome>>>,
  order: readonly DeletionStep[] = DELETION_ORDER,
): Promise<DeletionRun> {
  const results: StepResult[] = []
  for (const step of order) {
    const fn = steps[step]
    if (!fn) continue
    let outcome: StepOutcome
    try {
      outcome = await fn()
    } catch (err) {
      outcome = { ok: false, error: err instanceof Error ? err.message : 'threw' }
    }
    if (outcome.ok) {
      results.push({ step, ok: true, detail: outcome.detail })
    } else {
      results.push({ step, ok: false, error: outcome.error })
      return { ok: false, results, failedAt: step }
    }
  }
  return { ok: true, results }
}

/**
 * What the user is told when a step aborts.
 *
 * Named per step rather than the old blanket "Deletion failed. Contact
 * support." Two reasons: the user can tell whether their money is safe (the
 * Stripe message says so explicitly), and a support email now arrives with
 * enough detail to find the matching admin_audit row.
 */
export function deletionErrorMessage(step: DeletionStep): string {
  switch (step) {
    case 'stripe':
      return 'We could not cancel your subscription with our payment provider, so we have stopped and your account is untouched. Nothing has been deleted and you have not been charged anything extra. Cancel in Settings → Billing and try again, or email onetradingsocial@gmail.com.'
    case 'metaapi':
      return 'We could not remove your connected MT5 account from our broker provider, so we have stopped and your account is untouched. Disconnect the broker in Settings and try again.'
    case 'storage':
      return 'We could not delete your uploaded images, so we have stopped rather than leave them behind. Your account is untouched — please try again in a few minutes.'
    case 'analytics':
      return 'We could not finish de-identifying your usage history, so we have stopped. Your account is untouched — please try again.'
    case 'moderation':
      return 'We could not finish preparing your account for deletion. Your account is untouched — please try again.'
    case 'auth':
      return 'Everything outside your account was cleaned up, but the final delete did not go through. Your login still exists. Please try again, or email onetradingsocial@gmail.com.'
  }
}

// ---------------------------------------------------------------------------
// Storage (F6.2)
// ---------------------------------------------------------------------------

/** Which bucket a prefix lives in. Names come from the env at the call site;
 *  this module stays free of process.env so it is testable. */
export type BucketKind = 'public' | 'private'

export type StoragePrefix = {
  bucket: BucketKind
  /** Folder to enumerate, with no trailing slash. */
  prefix: string
  /** Avatars and covers are `{kind}/{uid}.{ext}` with NO uid folder, so they
   *  cannot be enumerated by listing a per-user directory -- the directory
   *  does not exist. These are matched by filename within a shared folder. */
  match: 'folder' | 'filename'
}

/**
 * Every place a user's objects can be, across the two-bucket split introduced
 * by migration 0044 (see fix-02-storage.md).
 *
 * The `filename` entries are the trap. `avatars/{uid}.png` and
 * `covers/{uid}.png` sit directly in a folder shared by every user, so a
 * careless `list('avatars')` + `remove(everything)` would wipe the entire
 * platform's avatars. That is why removal is gated on isUserOwnedKey() below
 * and not on the prefix alone.
 */
export function userStoragePrefixes(): readonly StoragePrefix[] {
  return [
    { bucket: 'public', prefix: 'avatars', match: 'filename' },
    { bucket: 'public', prefix: 'covers', match: 'filename' },
    { bucket: 'public', prefix: 'posts', match: 'folder' },
    { bucket: 'private', prefix: 'trades', match: 'folder' },
    { bucket: 'private', prefix: 'messages', match: 'folder' },
  ] as const
}

/**
 * Last line of defence before `.remove()`: is this key definitely this user's?
 *
 * Called on every path immediately before deletion, so a bug in the listing
 * code — a mis-set prefix, an off-by-one in the recursion, a Supabase response
 * shape change — cannot escalate into deleting another user's files. Deletion
 * code gets one chance to be wrong and the blast radius is permanent, so the
 * check is redundant with the enumeration on purpose.
 *
 * Two accepted shapes, matching migration 0044's own policy predicate
 * (`(storage.foldername(name))[2] = auth.uid()::text`, uid at index 2):
 *
 *   {kind}/{uid}/...      trades, messages, posts
 *   {kind}/{uid}.{ext}    avatars, covers   -- no uid folder at all
 */
export function isUserOwnedKey(key: string, userId: string): boolean {
  if (!userId || !key) return false
  // A traversal segment would let a crafted key climb out of the user's
  // folder. Storage keys are generated server-side from uuids, so this can
  // only fire on a bug -- which is the case worth catching.
  if (key.includes('..') || key.startsWith('/')) return false
  const parts = key.split('/')
  if (parts.length < 2) return false
  const [kind, second] = parts
  if (!kind) return false
  if (parts.length === 2) {
    // avatars/{uid}.png — the uid is the basename, extension stripped.
    const dot = second.lastIndexOf('.')
    const base = dot > 0 ? second.slice(0, dot) : second
    return base === userId
  }
  return second === userId
}

// ---------------------------------------------------------------------------
// Stripe (F6.3)
// ---------------------------------------------------------------------------

/** Statuses where there is nothing left to cancel. Cancelling one of these is
 *  not an error but it is a wasted API call and a confusing log line. */
export const TERMINAL_SUB_STATUSES = new Set([
  'canceled',
  'incomplete_expired',
])

export type StripeCloseoutPlan = {
  /** Subscription ids to cancel immediately. */
  cancel: string[]
  /**
   * Whether the customer object itself may be deleted.
   *
   * FALSE whenever any billing history exists, and this is the important half.
   * Item 6 Part 3: Australian record-keeping (ITAA 1936 s262A / TAA 1953)
   * requires records explaining a transaction to be kept for five years, and
   * Stripe's invoices ARE that record. `customers.del` does not delete the
   * invoices — it strips the name/email linkage off them, which destroys the
   * part that explains WHO the transaction was with while retaining the part
   * that is merely a number. That is the worst of both: worse for tax, no
   * better for privacy, because Stripe keeps the charge history either way.
   * APP 11.2 does not require destruction where retention is required by law.
   *
   * TRUE only for a customer that never transacted — a checkout that was
   * started and abandoned leaves a customer object with no invoice and no
   * charge, which has no record-keeping value and is pure residue. That one is
   * genuinely deleted.
   */
  deleteCustomer: boolean
}

/**
 * What to do with the Stripe customer, decided from data rather than in the
 * middle of an async call chain so it can be tested exhaustively.
 *
 * IMMEDIATE cancellation, not `cancel_at_period_end`, and not a refund.
 * Terms §11 (live): paid plans are charged in advance, "we do not offer
 * refunds for a change of mind — including for part of a period you have
 * already started". §12's refund duty is scoped to where *we* close a paid
 * account through no fault of the user; a user deleting their own account is
 * not that, so no refund is owed and none is issued (`prorate: false`).
 * Scheduling the cancellation for period end instead would leave a live
 * subscription object attached to an account that no longer exists, still
 * capable of renewing if anything ever cleared the schedule — the exact
 * failure F6.3 describes, merely postponed by a month.
 *
 * The consequence is that a paying user forfeits the remainder of the period
 * they paid for, so the UI must say so BEFORE they confirm. That warning is in
 * DangerZone, and terms §9 — which currently tells users deletion does not
 * cancel their subscription — has to be rewritten in the same deploy.
 */
export function stripeCloseoutPlan(input: {
  subscriptions: readonly { id: string; status: string }[]
  hasBillingHistory: boolean
}): StripeCloseoutPlan {
  return {
    cancel: input.subscriptions
      .filter((s) => !TERMINAL_SUB_STATUSES.has(s.status))
      .map((s) => s.id),
    deleteCustomer: !input.hasBillingHistory,
  }
}

// ---------------------------------------------------------------------------
// Third parties we cannot delete from (F6.6)
// ---------------------------------------------------------------------------

export type ThirdPartyResidue = {
  name: string
  /** What that recipient holds. Plain language — this is shown to the user. */
  holds: string
  /** How the user gets it removed. Honest about there being no API. */
  removal: string
}

/**
 * The recipients that hold an identifier we cannot delete for the user.
 *
 * This list is NOT decoration and it is NOT a stand-in for an integration. Two
 * of the six third parties in item 6 have a real deletion API and both are now
 * called for real: Stripe (subscriptions.cancel / customers.del) and MetaApi
 * (removeAccount). The four below do not, from this codebase, today:
 *
 *   Meta    — the Pixel has no per-user deletion endpoint. Meta's mechanism is
 *             a Data Deletion Request Callback registered against a Meta APP;
 *             this project has a Pixel id and no app, so there is nothing to
 *             register a callback on. Implementing it is a Meta-dashboard task
 *             first and a code task second.
 *   Reddit  — the Conversions API has no per-user deletion endpoint at all.
 *             Removal is a request to Reddit. Worth knowing: reddit-capi.ts
 *             sends raw IP and user-agent, not only hashes.
 *   Google  — GA does have a User Deletion API, and it is the one genuine
 *             candidate for automation here. It needs an OAuth2 service
 *             account and a property id, neither of which exists in the
 *             environment (see .env.example). Writing a call that no-ops for
 *             want of credentials would be indistinguishable from a working
 *             one, which is worse than not writing it.
 *   Resend  — sent-message logs (address plus full HTML body) are retained on
 *             their retention schedule. The contacts API only covers audiences,
 *             which this app does not use; transactional sends are not
 *             addressable by it.
 *
 * So the honest deliverable is disclosure, not a fake integration: the user is
 * told, in the deletion confirmation email, exactly who holds what and how to
 * ask. WS6 mirrors this list into the privacy policy.
 */
export const THIRD_PARTY_RESIDUE: readonly ThirdPartyResidue[] = [
  {
    name: 'Stripe',
    holds: 'your payment and invoice history, if you ever paid for a plan',
    removal:
      'Kept deliberately: Australian tax law requires us to keep records explaining transactions. Your subscription is cancelled and your card is detached, so nothing further can be charged. If you never paid, your customer record is deleted outright.',
  },
  {
    name: 'Meta (Facebook)',
    holds: 'browser-level advertising identifiers from pages you visited',
    removal:
      'Meta has no deletion request we can send on your behalf. You can remove it yourself under Facebook Settings → Your activity off Meta technologies.',
  },
  {
    name: 'Reddit',
    holds:
      'a hashed version of your email address, and the IP address and browser your requests came from',
    removal:
      'Reddit provides no per-user deletion endpoint. Email us and we will pass the request on to Reddit.',
  },
  {
    name: 'Google Analytics',
    holds: 'browser-level analytics identifiers from the marketing site',
    removal:
      'Clearing cookies for tradingsocial.io stops any further association. Email us if you want us to lodge a deletion request with Google.',
  },
  {
    name: 'Resend',
    holds:
      'copies of the emails we sent you, including your address, in their sending logs',
    removal:
      'These age out on Resend’s own retention schedule. Email us if you want them removed sooner.',
  },
] as const
