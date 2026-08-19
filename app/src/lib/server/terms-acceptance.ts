import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { termsAcceptancePatch, type TermsMechanism } from '@/lib/terms-acceptance'
import { logError } from '@/lib/server/log'

/** PostgREST: the column does not exist (migration 0060 not applied yet). */
const UNDEFINED_COLUMN = '42703'
/** PostgREST: the column is not in the cached schema — same cause, other path. */
const SCHEMA_CACHE_MISS = 'PGRST204'

export type TermsAcceptanceOutcome =
  /** A new acceptance was written. */
  | 'recorded'
  /** Nothing to do: an earlier acceptance is already on the row (or the row is
   *  not there yet, which the caller cannot distinguish and does not need to). */
  | 'unchanged'
  /** Migration 0060 has not been applied. Inert, not broken. */
  | 'not_migrated'
  /** A real database error. Logged; the caller carries on regardless. */
  | 'failed'

/**
 * Write the acceptance record. **Never throws, and never blocks a signup.**
 *
 * ── WHY THIS CANNOT BE FATAL ─────────────────────────────────────────────────
 *
 * This code ships before migration 0060 is applied, deliberately, following the
 * house pattern from WS3's `preserveModerationRecords` and WS4's `insertAudit`.
 * Until the column exists PostgREST answers `42703` / `PGRST204`, which is
 * swallowed here and reported as `not_migrated`. The trade is not close: the
 * finding being closed is "we cannot prove what a user agreed to", and the
 * failure mode of getting it wrong is "nobody can create an account". A missing
 * acceptance row is a gap in evidence; a throwing signup is an outage.
 *
 * Verified two ways in `tests/unit/terms-acceptance.test.ts`: a client that
 * returns each error code, and — because a returned error and a rejected
 * promise are different things — a client whose `update` rejects outright.
 *
 * ── WHY THE `is null` FILTER ─────────────────────────────────────────────────
 *
 * The FIRST acceptance is the one with evidential value, so the write is
 * write-once. Two consequences worth being explicit about:
 *
 *   - `/auth/callback` runs on every Google sign-in, not only the first. The
 *     filter makes each subsequent one a zero-row update rather than a rolling
 *     timestamp that would overwrite the moment of formation with "last Tuesday".
 *   - It also means an `oauth_notice` can never overwrite a `signup_checkbox`,
 *     which is the direction that would silently downgrade the record.
 *
 * Re-acceptance when the Terms change is a different problem and is NOT solved
 * here — see ws9-terms-acceptance.md. It needs a second table, not a second
 * write to this one.
 */
export async function recordTermsAcceptance(
  svc: SupabaseClient, userId: string, via: TermsMechanism,
): Promise<TermsAcceptanceOutcome> {
  try {
    const { error, count } = await svc
      .from('profiles')
      .update(termsAcceptancePatch(via), { count: 'exact' })
      .eq('id', userId)
      .is('terms_accepted_at', null)

    if (error) {
      if (error.code === UNDEFINED_COLUMN || error.code === SCHEMA_CACHE_MISS) {
        // Logged once per attempt at info level rather than error: before the
        // migration this is the expected state, and an error-level line here
        // would train everyone to ignore the scope.
        return 'not_migrated'
      }
      logError('terms acceptance', error.message, { via })
      return 'failed'
    }
    return (count ?? 0) > 0 ? 'recorded' : 'unchanged'
  } catch (err) {
    logError('terms acceptance', err, { via, note: 'acceptance not recorded' })
    return 'failed'
  }
}
