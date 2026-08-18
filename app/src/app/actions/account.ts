'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getStripe } from '@/lib/stripe'
import { raiseAlert } from '@/lib/server/alerts'
import { sendEmail, accountDeletedHtml } from '@/lib/server/email'
import { allowAuthAttempt, LOGIN_BUDGET } from '@/lib/server/auth-throttle'
import {
  runDeletionSteps, deletionErrorMessage, THIRD_PARTY_RESIDUE, type DeletionRun,
} from '@/lib/account-deletion'
import {
  collectDeletionContext, closeStripeForDeletion, removeMetaApiForDeletion,
  purgeUserStorage, scrubAnalytics, preserveModerationRecords, hardDeleteAuthUser,
} from '@/lib/server/account-deletion'

// Used directly as a <form action> from the (server-component) settings page,
// so it takes FormData only and returns void.
export async function saveAccount(formData: FormData): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const balanceRaw = Number(formData.get('account_balance') ?? 0)
  const balance = Number.isFinite(balanceRaw) && balanceRaw >= 0 ? balanceRaw : 0
  const currency = String(formData.get('account_currency') ?? 'USD').trim().toUpperCase().slice(0, 3) || 'USD'

  await supabase
    .from('profiles')
    .update({ account_balance: balance, account_currency: currency })
    .eq('id', user.id)

  // Backfill: risk%-sized trades derive their risk amount (and money P/L) from the
  // account balance. Changing the balance recomputes them so historical P/L isn't stuck at $0.
  const { data: trades } = await supabase
    .from('trades')
    .select('id, risk_percent, r_multiple, status')
    .eq('user_id', user.id)
    .eq('sizing_mode', 'risk_percent')

  for (const t of trades ?? []) {
    const riskAmount = balance * ((t.risk_percent ?? 0) / 100)
    const update: { risk_amount: number; pnl_amount?: number } = { risk_amount: riskAmount }
    if (t.status === 'closed' && t.r_multiple != null) update.pnl_amount = t.r_multiple * riskAmount
    await supabase.from('trades').update(update).eq('id', t.id)
  }

  revalidatePath('/settings')
  revalidatePath('/journal')
}

// GDPR-style data export (Sprint 3, row 53). Returns a JSON string of the
// user's own rows across every table that references them.
export async function exportMyData(): Promise<{ error?: string; json?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const uid = user.id

  const [profile, trades, posts, comments, likes, follows, feedback, rules, subs, completions, brokers] = await Promise.all([
    // Service client, and it MUST stay `select('*')`: this is the GDPR export,
    // so it has to return every column the platform holds about the user --
    // including the ones 0047 revokes from client roles (account_balance,
    // stripe_customer_id, is_internal, acquisition_source, the trial and
    // lifecycle-email timestamps). PostgREST does not silently drop columns a
    // role cannot read; `select('*')` fails outright with 42501, so the user
    // client would have turned the whole export into an error the moment 0047
    // landed. Scoped to uid from getUser() -- the caller's own row only.
    createServiceClient().from('profiles').select('*').eq('id', uid).maybeSingle(),
    supabase.from('trades').select('*').eq('user_id', uid),
    supabase.from('posts').select('*').eq('author_id', uid),
    supabase.from('comments').select('*').eq('author_id', uid),
    supabase.from('likes').select('*').eq('user_id', uid),
    supabase.from('follows').select('*').or(`follower_id.eq.${uid},following_id.eq.${uid}`),
    supabase.from('feedback').select('*').eq('user_id', uid),
    supabase.from('trading_rules').select('*').eq('user_id', uid),
    supabase.from('subscriptions').select('*').eq('user_id', uid),
    supabase.from('lesson_completions').select('*').eq('user_id', uid),
    supabase.from('broker_accounts').select('id, provider, login, server, status, created_at').eq('user_id', uid),
  ])

  const payload = {
    exportedAt: new Date().toISOString(),
    account: { id: uid, email: user.email },
    profile: profile.data,
    trades: trades.data ?? [],
    posts: posts.data ?? [],
    comments: comments.data ?? [],
    likes: likes.data ?? [],
    follows: follows.data ?? [],
    feedback: feedback.data ?? [],
    tradingRules: rules.data ?? [],
    subscriptions: subs.data ?? [],
    lessonCompletions: completions.data ?? [],
    brokerAccounts: brokers.data ?? [],
  }
  return { json: JSON.stringify(payload, null, 2) }
}

export type DeleteAccountInput = {
  /** The user's own email address, typed out. */
  confirmation: string
  /** Required when the account has a password identity; ignored otherwise. */
  password?: string
}

/**
 * Permanent account deletion (audit item 6).
 *
 * WHAT THIS USED TO BE: one call to `admin.deleteUser`. That call was, and
 * still is, exactly right — no `shouldSoftDelete` argument, so auth.users is
 * hard-deleted, `profiles_id_fkey` cascades 30 tables and the email address is
 * genuinely released. What it missed was everything outside Postgres: the
 * Stripe subscription kept billing a person who no longer existed and could no
 * longer reach the portal (F6.3), the MetaApi account kept holding the user's
 * MT5 investor password (F6.4), not one uploaded file was ever removed from
 * either bucket (F6.2), and the analytics rows survived keyed on a stable
 * anon_id that made them re-linkable (F6.5). Deletion also *manufactured* a
 * fresh full copy of every trade on its way out (F6.1 — fixed in migration
 * 0051, not here).
 *
 * WHY THE ORDER IS THE ORDER: see the header of `lib/account-deletion.ts`.
 * Short version — every external handle is destroyed by the local delete, so
 * every external call has to precede it, and the run aborts at the first
 * failure so a partial deletion always leaves a usable account rather than a
 * half-erased one.
 *
 * ON GRACE PERIODS, deliberately not implemented. A soft-delete window is the
 * obvious answer to F6.9 and it is the wrong one here, because it trades away
 * the single property of this flow that already works: the moment deletion
 * becomes reversible, the email address must stay reserved for the length of
 * the window, so "delete and sign up again" — which works today, and which
 * people actually do — starts failing with "user already registered". A
 * fortnight of unusable limbo is not obviously better than an irreversible
 * delete the user was properly warned about. The confirmation is strengthened
 * instead: a typed email address (not the public username), a password
 * re-check where one exists, an explicit warning when a paid period is about
 * to be forfeited, and a confirmation email so a hijacked session cannot do
 * this silently.
 */
export async function deleteMyAccount(input: DeleteAccountInput): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  if (!user.email) return { error: 'This account has no email address on file. Please contact support.' }

  // Confirmation is the EMAIL, not the username. The username is the public
  // profile URL (`/[username]`), so anyone who has looked at the profile
  // already holds the old confirmation string — it proved nothing beyond
  // "you can read a web page" (F6.9).
  if (input.confirmation.trim().toLowerCase() !== user.email.trim().toLowerCase()) {
    return { error: 'That is not the email address on this account.' }
  }

  // Re-authenticate where a credential exists to re-authenticate against. A
  // session cookie alone should not be able to destroy an account permanently.
  // Google-only accounts have no password to check, so they fall back to the
  // typed address; GoTrue's reauthenticate()/nonce flow would close that gap
  // and is the natural follow-up.
  const hasPassword = (user.identities ?? []).some((i) => i.provider === 'email')
  if (hasPassword) {
    if (!input.password) return { error: 'Enter your password to confirm.' }
    // Same throttle the login form uses, for the same reason: this is a
    // password-checking endpoint and would otherwise be an unmetered oracle.
    if (!(await allowAuthAttempt(LOGIN_BUDGET, user.email))) {
      return { error: 'Too many attempts. Wait a few minutes and try again.' }
    }
    // A DETACHED client, not the cookie-bound one: signInWithPassword on the
    // request client would rewrite the session cookie mid-action. persistSession
    // is off, so this verifies the credential and stores nothing.
    const probe = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    )
    const { error: pwErr } = await probe.auth.signInWithPassword({
      email: user.email, password: input.password,
    })
    if (pwErr) return { error: 'That password is not correct.' }
    // Local scope only. A global sign-out would kill every session this user
    // has everywhere — which is fine when the deletion proceeds and actively
    // wrong when it aborts two steps later and they are still a customer.
    await probe.auth.signOut({ scope: 'local' })
  }

  const svc = createServiceClient()
  const uid = user.id

  // Read every pointer BEFORE anything is destroyed. After the auth delete,
  // stripe_customer_id and metaapi_account_id do not exist anywhere.
  const ctx = await collectDeletionContext(svc, uid, user.email)

  const run = await runDeletionSteps({
    stripe: async () => (ctx.stripeCustomerId
      ? closeStripeForDeletion(getStripe(), ctx.stripeCustomerId)
      : { ok: true, detail: { skipped: 'no_customer' } }),
    metaapi: async () => (ctx.metaapiAccountId
      ? removeMetaApiForDeletion(ctx.metaapiAccountId)
      : { ok: true, detail: { skipped: 'no_broker' } }),
    storage: () => purgeUserStorage(svc, uid),
    analytics: () => scrubAnalytics(svc, uid, ctx.anonIds),
    moderation: () => preserveModerationRecords(svc, uid, ctx.email),
    auth: () => hardDeleteAuthUser(svc, uid),
  })

  // One admin_audit row per attempt, successful or not. This is the proof the
  // erasure happened (and how far it got when it did not) — without it a
  // half-completed deletion is invisible to everyone including the user, which
  // is the failure mode F6.12 describes. Deliberately records the uid and the
  // per-step outcomes and NOT the email, username or any content: the record
  // exists to show that an erasure was performed, not to preserve the person.
  await logDeletionAttempt(svc, uid, run)

  if (!run.ok && run.failedAt) {
    await raiseAlert(
      svc,
      'account_deletion_failed',
      `Account deletion aborted at "${run.failedAt}" for ${uid}. Completed: ${run.results.filter((r) => r.ok).map((r) => r.step).join(', ') || 'none'}. The account is still live.`,
    )
    return { error: deletionErrorMessage(run.failedAt) }
  }

  // Best-effort, and after the point of no return on purpose: the send must
  // never be the reason a completed deletion reports failure. The address came
  // out of the preflight because auth.users no longer holds it.
  if (ctx.email) {
    try {
      const res = await sendEmail({
        to: ctx.email,
        subject: 'Your TradingSocial account has been deleted',
        html: accountDeletedHtml({ residue: THIRD_PARTY_RESIDUE, exchanges: ctx.exchanges }),
      })
      if (!res.sent) console.error('[deletion] confirmation email not sent', res.error)
    } catch (err) {
      console.error('[deletion] confirmation email threw', err)
    }
  }

  await supabase.auth.signOut()
  redirect('/login?deleted=1')
}

/** Fire-and-forget record of a deletion attempt. Same reasoning as
 *  logAdminAction: an audit failure must never block or fail the action it is
 *  describing. `actor_id` is null because by the time this runs the profile it
 *  would point at is gone (and on the failure path the actor is not an admin). */
async function logDeletionAttempt(
  svc: ReturnType<typeof createServiceClient>,
  uid: string,
  run: DeletionRun,
): Promise<void> {
  try {
    await svc.from('admin_audit').insert({
      actor_id: null,
      actor_email: null,
      action: run.ok ? 'account.deleted' : 'account.deletion_failed',
      target_type: 'account',
      target_id: uid,
      detail: {
        failedAt: run.failedAt ?? null,
        steps: run.results.map((r) => ({
          step: r.step, ok: r.ok, detail: r.detail ?? null, error: r.error ?? null,
        })),
      },
    })
  } catch (err) {
    console.error('[deletion] audit insert failed', uid, err)
  }
}
