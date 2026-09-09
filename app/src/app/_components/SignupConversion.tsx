import { RedditPixel } from './RedditPixel'
import { MetaPixel } from './MetaPixel'

/**
 * The signup conversion pair, fired once when onboarding hands off with
 * `?signup=1&cid=`.
 *
 * Extracted from `app/page.tsx` because onboarding no longer always lands on
 * `/`: a user who picked "Connect MT5 broker" at step 5 is now sent to
 * `/settings#broker` instead (actions/profile.ts). Both pixels gate on the
 * query param, so a landing route that does not render them drops the
 * conversion silently — no error, the events simply stop. Any route that
 * onboarding can redirect to must render this.
 *
 * MetaPixel must render before RedditPixel: both gate on ?signup=1 and effects
 * run in document order — RedditPixel strips the param when done.
 */
export function SignupConversion({
  email,
  externalId,
  conversionId,
}: {
  email?: string | null
  externalId: string
  conversionId?: string
}) {
  return (
    <>
      <MetaPixel
        event="CompleteRegistration"
        email={email}
        externalId={externalId}
        requireParam="signup"
      />
      <RedditPixel
        event="SignUp"
        email={email}
        externalId={externalId}
        conversionId={conversionId}
        requireParam="signup"
      />
    </>
  )
}
