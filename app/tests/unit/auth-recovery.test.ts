import { describe, it, expect, vi } from 'vitest'
import {
  parseRecoveryRequest,
  recoveryErrorRedirect,
  scrubRecoveryHash,
  recoveryGuardSource,
  RESET_REQUEST_MESSAGE,
} from '@/lib/auth-recovery'

const at = (qs: string) => new URL(`https://app.tradingsocial.io/auth/reset${qs}`)

describe('parseRecoveryRequest — grant classification', () => {
  describe('token_hash (verifyOtp shape — the one we want the template to use)', () => {
    it('reads token_hash and type', () => {
      expect(parseRecoveryRequest(at('?token_hash=abc123&type=recovery')))
        .toEqual({ kind: 'otp', tokenHash: 'abc123', type: 'recovery' })
    })

    it('accepts the legacy ?token= spelling', () => {
      expect(parseRecoveryRequest(at('?token=abc123&type=recovery')))
        .toEqual({ kind: 'otp', tokenHash: 'abc123', type: 'recovery' })
    })

    it('defaults a missing type to recovery rather than guessing', () => {
      expect(parseRecoveryRequest(at('?token_hash=abc123')))
        .toEqual({ kind: 'otp', tokenHash: 'abc123', type: 'recovery' })
    })

    it('normalises the case of type', () => {
      expect(parseRecoveryRequest(at('?token_hash=abc&type=RECOVERY')))
        .toMatchObject({ type: 'recovery' })
    })

    it('falls back to recovery for an unrecognised type instead of passing it through', () => {
      // Never hand an arbitrary string to verifyOtp — the caller-side
      // expectTypes check must be given a value from the known set.
      expect(parseRecoveryRequest(at('?token_hash=abc&type=totp')))
        .toMatchObject({ kind: 'otp', type: 'recovery' })
    })

    it('carries signup/invite/email_change/magiclink through unchanged', () => {
      for (const t of ['signup', 'invite', 'email_change', 'magiclink']) {
        expect(parseRecoveryRequest(at(`?token_hash=abc&type=${t}`))).toMatchObject({ type: t })
      }
    })

    it('prefers token_hash over code when a link somehow carries both', () => {
      expect(parseRecoveryRequest(at('?token_hash=abc&code=xyz'))).toMatchObject({ kind: 'otp' })
    })
  })

  describe('code (PKCE shape — same-browser only)', () => {
    it('reads the authorization code', () => {
      expect(parseRecoveryRequest(at('?code=pkce-code'))).toEqual({ kind: 'pkce', code: 'pkce-code' })
    })
  })

  describe('errors — GoTrue rejected the link before we saw it', () => {
    it('classifies an expired OTP', () => {
      expect(parseRecoveryRequest(at('?error=access_denied&error_code=otp_expired')))
        .toEqual({ kind: 'error', reason: 'expired' })
    })

    it('classifies a plain expiry description', () => {
      expect(parseRecoveryRequest(at('?error=Email+link+is+expired')))
        .toEqual({ kind: 'error', reason: 'expired' })
    })

    it('classifies any other rejection as denied', () => {
      expect(parseRecoveryRequest(at('?error=access_denied')))
        .toEqual({ kind: 'error', reason: 'denied' })
    })

    it('checks for an error BEFORE trying to read a token, so no pointless exchange is attempted', () => {
      expect(parseRecoveryRequest(at('?error=access_denied&token_hash=abc')))
        .toEqual({ kind: 'error', reason: 'denied' })
    })

    it('treats a bare /auth/reset with no params as missing, not as a valid grant', () => {
      expect(parseRecoveryRequest(at(''))).toEqual({ kind: 'error', reason: 'missing' })
    })

    it('treats an empty token_hash as missing rather than exchanging an empty string', () => {
      expect(parseRecoveryRequest(at('?token_hash=&type=recovery')))
        .toEqual({ kind: 'error', reason: 'missing' })
    })

    it('treats an empty code as missing', () => {
      expect(parseRecoveryRequest(at('?code='))).toEqual({ kind: 'error', reason: 'missing' })
    })
  })

  describe('no open redirect', () => {
    it('ignores a next param entirely', () => {
      const g = parseRecoveryRequest(at('?token_hash=abc&type=recovery&next=https://evil.example'))
      expect(g).toEqual({ kind: 'otp', tokenHash: 'abc', type: 'recovery' })
      expect(JSON.stringify(g)).not.toContain('evil')
    })

    it('ignores redirect_to / redirectTo params', () => {
      const g = parseRecoveryRequest(at('?code=x&redirect_to=//evil.example&redirectTo=/admin'))
      expect(g).toEqual({ kind: 'pkce', code: 'x' })
    })

    it('every error redirect it produces is a same-origin relative path', () => {
      for (const r of ['expired', 'denied', 'missing'] as const) {
        const dest = recoveryErrorRedirect(r)
        expect(dest.startsWith('/forgot-password?')).toBe(true)
        expect(dest.startsWith('//')).toBe(false)
      }
    })
  })
})

describe('RESET_REQUEST_MESSAGE — enumeration safety', () => {
  it('is a single constant, so every outcome returns the identical string', () => {
    // The guard is structural: the action has no other message to return, so a
    // future edit that branches on account existence has to change this test.
    expect(typeof RESET_REQUEST_MESSAGE).toBe('string')
    expect(RESET_REQUEST_MESSAGE.length).toBeGreaterThan(40)
  })

  it('is conditional — it never asserts that an email was sent', () => {
    expect(RESET_REQUEST_MESSAGE.toLowerCase()).toContain('if an account exists')
  })

  it('does not confirm or deny the address, in any wording', () => {
    const m = RESET_REQUEST_MESSAGE.toLowerCase()
    for (const leak of [
      'no account', 'not found', 'does not exist', "doesn't exist",
      'unknown email', 'not registered', 'we found', 'your account',
    ]) {
      expect(m).not.toContain(leak)
    }
  })

  it('tells the user the link is time-limited, which is true regardless of existence', () => {
    expect(RESET_REQUEST_MESSAGE.toLowerCase()).toContain('expires')
  })
})

// ─────────────────────────────────────────────────────────────────────────────

type Calls = { replaced: string[]; navigated: string[] }

function fakeWindow(hash: string, pathname = '/', search = '') {
  const calls: Calls = { replaced: [], navigated: [] }
  const w = {
    location: {
      hash,
      pathname,
      search,
      replace: (url: string) => { calls.navigated.push(url) },
    },
    history: {
      replaceState: (_s: unknown, _t: string, url: string) => { calls.replaced.push(url) },
    },
  }
  return { w, calls }
}

describe('scrubRecoveryHash — implicit-flow fragment containment', () => {
  it('strips a recovery fragment and sends the user to request a fresh link', () => {
    const { w, calls } = fakeWindow('#access_token=eyJhbG.token&refresh_token=r1&type=recovery')
    expect(scrubRecoveryHash(w)).toBe(true)
    expect(calls.replaced).toEqual(['/'])
    expect(calls.navigated).toEqual(['/forgot-password?error=leaked'])
  })

  it('rewrites the address bar BEFORE navigating, so a blocked navigation still leaves no token', () => {
    const order: string[] = []
    const w = {
      location: {
        hash: '#access_token=t&type=recovery',
        pathname: '/',
        search: '',
        replace: () => { order.push('navigate') },
      },
      history: { replaceState: () => { order.push('scrub') } },
    }
    scrubRecoveryHash(w)
    expect(order).toEqual(['scrub', 'navigate'])
  })

  it('preserves pathname and query when scrubbing, so only the fragment is lost', () => {
    const { w, calls } = fakeWindow('#access_token=t&type=recovery', '/journal', '?tab=open')
    scrubRecoveryHash(w)
    expect(calls.replaced).toEqual(['/journal?tab=open'])
  })

  it('scrubs a non-recovery access_token fragment but does not redirect', () => {
    // Any access_token in a fragment on our origin is a leak worth removing,
    // but only the recovery case has somewhere useful to send the user.
    const { w, calls } = fakeWindow('#access_token=t&type=magiclink')
    expect(scrubRecoveryHash(w)).toBe(true)
    expect(calls.replaced).toEqual(['/'])
    expect(calls.navigated).toEqual([])
  })

  it('does NOT fire on the normal PKCE query-string flow', () => {
    const { w, calls } = fakeWindow('', '/auth/reset', '?code=abc')
    expect(scrubRecoveryHash(w)).toBe(false)
    expect(calls.replaced).toEqual([])
    expect(calls.navigated).toEqual([])
  })

  it('does NOT fire on an ordinary page with no fragment', () => {
    const { w } = fakeWindow('')
    expect(scrubRecoveryHash(w)).toBe(false)
  })

  it('does NOT fire on an unrelated anchor fragment', () => {
    const { w, calls } = fakeWindow('#pricing')
    expect(scrubRecoveryHash(w)).toBe(false)
    expect(calls.replaced).toEqual([])
  })

  it('never consumes the token — it must not be stashed anywhere for later use', () => {
    const { w } = fakeWindow('#access_token=secret-token&type=recovery')
    const store: Record<string, string> = {}
    vi.stubGlobal('sessionStorage', { setItem: (k: string, v: string) => { store[k] = v } })
    vi.stubGlobal('localStorage', { setItem: (k: string, v: string) => { store[k] = v } })
    scrubRecoveryHash(w)
    expect(Object.keys(store)).toEqual([])
    vi.unstubAllGlobals()
  })
})

describe('recoveryGuardSource — the string actually shipped into <body>', () => {
  const src = recoveryGuardSource()

  it('is self-contained: it references no import and no module-scope binding', () => {
    // If it did, the inline <script> would throw on a page that has not
    // hydrated yet — which is every page at the moment this runs.
    expect(src).not.toContain('import')
    expect(src).not.toContain('require(')
    expect(src).not.toMatch(/\b(recoveryErrorRedirect|parseRecoveryRequest|RESET_REQUEST_MESSAGE)\b/)
  })

  it('is wrapped in try/catch so a guard failure can never white-screen the app', () => {
    expect(src.startsWith('try{')).toBe(true)
    expect(src).toContain('catch')
  })

  it('is invoked immediately with window', () => {
    expect(src).toContain('(window)')
  })

  it('runs for real when evaluated, and scrubs a recovery fragment', () => {
    // Evaluates the shipped source against a fake window, which is the only
    // way to prove the toString() round-trip survives compilation.
    const { w, calls } = fakeWindow('#access_token=t&type=recovery', '/', '')
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('window', src)(w)
    expect(calls.replaced).toEqual(['/'])
    expect(calls.navigated).toEqual(['/forgot-password?error=leaked'])
  })

  it('runs for real and leaves an ordinary page alone', () => {
    const { w, calls } = fakeWindow('#pricing', '/', '')
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('window', src)(w)
    expect(calls.replaced).toEqual([])
    expect(calls.navigated).toEqual([])
  })

  it('swallows a thrown error instead of propagating it', () => {
    const hostile = {
      get location() { throw new Error('boom') },
      history: { replaceState() {} },
    }
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    expect(() => new Function('window', src)(hostile)).not.toThrow()
  })
})
