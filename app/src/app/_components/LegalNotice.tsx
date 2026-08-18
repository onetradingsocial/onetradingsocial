import { LEGAL, EXTERNAL_LINK } from '@/lib/marketing'

/**
 * The APP 5 notice for the Google sign-in path.
 *
 * `GoogleButton` is rendered ABOVE the `<form>` on both the signup and login
 * pages, so the "I agree to the Terms…" checkbox inside that form has never
 * gated it: a user who signed up with Google accepted nothing and was shown no
 * link to any legal document at all (audit item 4, finding 3 / S3). That is
 * simultaneously an APP 5 failure and a contract-formation gap for the Terms
 * and the financial disclaimer — the latter existing precisely because this is
 * a trading product.
 *
 * This is passive consent, which is acceptable in Australia when the links are
 * visible at the point of collection and the user acts after seeing them. It is
 * NOT as strong as the checkbox on the email path, and it does not record an
 * acceptance anywhere — nothing in this codebase records the email-path
 * acceptance either. Persisting a timestamped acceptance for both paths needs a
 * column and a migration and is the correct next step; this closes the
 * disclosure half now rather than leaving both halves open.
 *
 * Rendered directly beneath the button on both forms so it cannot drift out of
 * sight of the control it governs.
 */
export function OAuthLegalNotice() {
  return (
    <p className="fl-oauth-legal">
      By continuing with Google you agree to our{' '}
      <a href={LEGAL.terms} {...EXTERNAL_LINK}>Terms</a>,{' '}
      <a href={LEGAL.privacy} {...EXTERNAL_LINK}>Privacy Policy</a> and{' '}
      <a href={LEGAL.disclaimer} {...EXTERNAL_LINK}>financial disclaimer</a>.
      Google sends us your name, email address and profile photo.
    </p>
  )
}

/**
 * One-line "how we handle this" pointer for a collection surface that does not
 * warrant a paragraph of its own. Keep the `what` short — it is the specific
 * fact the user would not otherwise guess, not a summary of the policy.
 */
export function PrivacyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="ts-privacy-note">
      {children}{' '}
      <a href={LEGAL.privacy} {...EXTERNAL_LINK}>How we handle your data</a>
    </p>
  )
}
