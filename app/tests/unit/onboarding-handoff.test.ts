import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Structural guard for the onboarding data-source handoff.
 *
 * Step 5 asks how the user will get trades into the journal. Nine real users
 * picked "Connect MT5 broker"; one ever reached the connect form. Nothing was
 * broken in the usual sense — the intent was captured, written to
 * `profiles.intended_source` and even used by the welcome email. It simply had
 * no route: `saveOnboarding` sent everyone to the feed, and the reveal card
 * displayed the tag "Broker connected" beside the user's real profile facts,
 * so the eight who never connected had been told they already had.
 *
 * Two things have to stay true for that fix to hold, and both are the kind that
 * rot silently when someone adds a fourth data source or a new landing route:
 *
 *  1. Every route `saveOnboarding` can redirect to renders <SignupConversion>.
 *     The Meta and Reddit signup pixels gate on `?signup=1`; a landing route
 *     without them drops the conversion with no error at all — the events just
 *     stop arriving, which is indistinguishable from nobody signing up.
 *
 *  2. No `OB_CONNECT` tag claims a finished state. These strings render on the
 *     reveal card as if they were facts about the account.
 *
 * Source text rather than imports, for the reason admin-gate.test.ts gives:
 * importing an RSC here drags in next/headers and a request scope that does not
 * exist in vitest. The question is about the text.
 */

const SRC = join(process.cwd(), 'src')
const read = (...p: string[]) => readFileSync(join(SRC, ...p), 'utf8')

const PROFILE_ACTIONS = read('app', 'actions', 'profile.ts')
const ONBOARDING_FORM = read('app', 'onboarding', 'OnboardingForm.tsx')

/** Every `redirect('...')` in saveOnboarding that carries the signup param. */
function signupRedirectPaths(src: string): string[] {
  const out: string[] = []
  for (const m of src.matchAll(/redirect\(\s*`([^`]*signup=1[^`]*)`/g)) {
    // Path only: drop the query string and hash.
    out.push(m[1].split('?')[0])
  }
  return out
}

describe('onboarding signup handoff', () => {
  it('redirects at least the feed and the broker connect form', () => {
    const paths = signupRedirectPaths(PROFILE_ACTIONS)
    expect(paths).toContain('/')
    expect(paths).toContain('/settings')
  })

  it('renders SignupConversion on every route onboarding can land on', () => {
    const paths = signupRedirectPaths(PROFILE_ACTIONS)
    expect(paths.length).toBeGreaterThan(0)

    // '/' -> app/page.tsx, '/settings' -> app/settings/page.tsx
    for (const path of paths) {
      const segments = path.split('/').filter(Boolean)
      const src = read('app', ...segments, 'page.tsx')
      expect(
        src.includes('SignupConversion'),
        `${path} is a signup landing route but does not render <SignupConversion>, ` +
        'so the Meta and Reddit signup pixels never fire for users sent there.',
      ).toBe(true)
    }
  })

  it('reads the signup param on every landing route', () => {
    for (const path of signupRedirectPaths(PROFILE_ACTIONS)) {
      const segments = path.split('/').filter(Boolean)
      const src = read('app', ...segments, 'page.tsx')
      expect(
        /signup\?*:/.test(src) && src.includes("=== '1'"),
        `${path} renders SignupConversion but does not read ?signup=1 from searchParams.`,
      ).toBe(true)
    }
  })
})

describe('onboarding data-source tags', () => {
  /** The `tag:` values inside the OB_CONNECT array. */
  function connectTags(src: string): string[] {
    const block = src.slice(
      src.indexOf('const OB_CONNECT'),
      src.indexOf('const REVEAL_LEAD'),
    )
    return [...block.matchAll(/tag:\s*'([^']+)'/g)].map((m) => m[1])
  }

  it('finds every data-source tag', () => {
    expect(connectTags(ONBOARDING_FORM)).toHaveLength(3)
  })

  it('never claims a state the user has not reached', () => {
    // The reveal card shows these beside real profile facts, so a past
    // participle reads as an accomplished fact. "Broker connected" was shown to
    // nine users; one had a broker.
    for (const tag of connectTags(ONBOARDING_FORM)) {
      expect(
        /\b(connected|imported|synced|linked|verified)\b/i.test(tag),
        `OB_CONNECT tag "${tag}" describes a completed state, but it renders on ` +
        'the reveal card before the user has done anything.',
      ).toBe(false)
    }
  })

  it('only offers a button for a destination the redirect actually serves', () => {
    const ctaBlock = ONBOARDING_FORM.slice(ONBOARDING_FORM.indexOf('const REVEAL_CTA'))
    const keys = [...ctaBlock.slice(0, ctaBlock.indexOf('}')).matchAll(/^\s*(\w+):/gm)]
      .map((m) => m[1])
      .filter((k) => k !== 'manual')

    // A non-default CTA names a destination ("Connect my broker"), so the
    // action must have a matching branch or the button lies about where it goes.
    for (const key of keys) {
      expect(
        PROFILE_ACTIONS.includes(`intendedSource === '${key}'`),
        `REVEAL_CTA has a custom button for "${key}" but saveOnboarding has no ` +
        `redirect branch for it, so it lands on the feed instead.`,
      ).toBe(true)
    }
  })
})
