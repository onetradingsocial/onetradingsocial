import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// repo root is three levels up from app/tests/unit
const ROOT = join(__dirname, '..', '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const AUTH = 'app/src/app/actions/auth.ts'

/**
 * The failure this guards against is a partial rollout.
 *
 * Supabase's Attack Protection setting is one switch for the whole project:
 * flip it and GoTrue starts demanding a token on signup, sign-in AND recovery.
 * Wiring the widget into the signup form only — the obvious reading of "put a
 * CAPTCHA on signup" — would leave every existing user unable to log in or
 * reset their password, with "captcha protection: request disallowed" as the
 * only clue.
 *
 * So the unit under test is not "signup sends a token", it is "every GoTrue
 * call that the switch covers sends one, and every form that reaches them
 * renders the widget".
 */
describe('captcha is wired into every auth path, not just signup', () => {
  const CALLS = [
    ['signUp', 'auth.signUp('],
    ['signInWithPassword', 'auth.signInWithPassword('],
    ['resetPasswordForEmail', 'auth.resetPasswordForEmail('],
    ['resend', 'auth.resend('],
  ] as const

  it.each(CALLS)('%s passes captchaToken', (_name, needle) => {
    const src = read(AUTH)
    const at = src.indexOf(needle)
    expect(at, `${needle} not found — did the call move?`).toBeGreaterThan(-1)
    // The options object of a call this small is comfortably inside 400 chars.
    const call = src.slice(at, at + 400)
    expect(call).toContain('captchaToken')
  })

  it('reads the token from the field the widget actually writes', () => {
    // One constant, imported by the action from the component, so the two ends
    // cannot drift apart silently.
    expect(read(AUTH)).toContain("import { CAPTCHA_FIELD } from '@/app/_components/Turnstile'")
    expect(read(AUTH)).toContain('formData.get(CAPTCHA_FIELD)')
    expect(read('app/src/app/_components/Turnstile.tsx'))
      .toContain("export const CAPTCHA_FIELD = 'cf-turnstile-response'")
  })

  const FORMS = [
    'app/src/app/signup/SignupForm.tsx',
    'app/src/app/login/LoginForm.tsx',
    'app/src/app/forgot-password/ForgotPasswordForm.tsx',
    'app/src/app/check-email/CheckEmailForm.tsx',
  ]

  it.each(FORMS)('%s renders the widget inside its form', (p) => {
    const src = read(p)
    expect(src).toContain("import { Turnstile } from '@/app/_components/Turnstile'")
    expect(src).toContain('<Turnstile resetOn={state} />')
    // Inside the <form>, or the hidden input is not in the submitted FormData.
    const formStart = src.indexOf('<form action={action}')
    const formEnd = src.indexOf('</form>')
    const widget = src.indexOf('<Turnstile')
    expect(formStart).toBeGreaterThan(-1)
    expect(widget).toBeGreaterThan(formStart)
    expect(widget).toBeLessThan(formEnd)
  })

  it('stays inert until the site key is configured', () => {
    // The deploy has to be able to land BEFORE the dashboard switch is flipped:
    // a widget that rendered without a key would submit an empty token and
    // GoTrue would refuse it. Same ship-dark order the confirmation work used.
    const src = read('app/src/app/_components/Turnstile.tsx')
    expect(src).toContain('process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY')
    expect(src).toMatch(/if \(!SITE_KEY\) return null/)
    expect(src).toMatch(/if \(!SITE_KEY\) return\n/)
  })

  it('the CSP allows the challenge to load', () => {
    // Report-Only today, but this is on the critical path for enforcing it, and
    // an enforcing policy without these three would break login, not tracking.
    const cfg = read('app/next.config.ts')
    for (const directive of ['script-src', 'frame-src', 'connect-src']) {
      const line = cfg.split('\n').find((l) => l.includes(`"${directive} `))
      expect(line, `${directive} not found in the CSP`).toBeTruthy()
      expect(line).toContain('https://challenges.cloudflare.com')
    }
  })
})
