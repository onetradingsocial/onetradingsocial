import { LEGAL, EXTERNAL_LINK } from '@/lib/marketing'

/**
 * The app's first footer.
 *
 * `app/src/app/layout.tsx` rendered nav, children, modals and three trackers and
 * then closed `</body>` — there was no `<footer>` anywhere in `app/src`, and
 * `/privacy` appeared nowhere in the application at all (audit item 4,
 * finding 1). The privacy policy is hosted on the marketing origin, so from
 * inside the product it was structurally unreachable.
 *
 * Every collection surface that does not warrant its own inline notice — the
 * journal, the composer, the feed, avatar and cover uploads, referrals, the
 * feature board — is covered by this, which is the point of a footer. The
 * surfaces that DO warrant their own notice (broker credentials, checkout,
 * onboarding, uploads into private storage) carry one as well; this is the
 * floor, not the ceiling.
 *
 * Server component, no state, no client bundle cost.
 */
export function AppFooter() {
  return (
    <footer className="app-footer">
      <nav aria-label="Legal">
        <a href={LEGAL.terms} {...EXTERNAL_LINK}>Terms</a>
        <span aria-hidden="true">·</span>
        <a href={LEGAL.privacy} {...EXTERNAL_LINK}>Privacy</a>
        <span aria-hidden="true">·</span>
        <a href={LEGAL.disclaimer} {...EXTERNAL_LINK}>Financial disclaimer</a>
        <span aria-hidden="true">·</span>
        <a href="mailto:onetradingsocial@gmail.com">Contact</a>
      </nav>
      <p>
        TradingSocial is an education and performance-tracking platform. Nothing here is financial
        advice.
      </p>
    </footer>
  )
}
