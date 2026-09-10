import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { startTrialIfUnstarted } from '@/lib/server/trial-start'
import { isFreshAccount, OAUTH_SIGNUP_WINDOW_MS } from '@/lib/server/oauth-signup'
import { trialState, trialDaysLeft, TRIAL_DAYS } from '@/lib/entitlements'

// repo root is three levels up from app/tests/unit
const ROOT = join(__dirname, '..', '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const UID = '22222222-2222-4222-8222-222222222222'

// ---------------------------------------------------------------------------
// A fake profiles table with the ONE property that makes the latch work: the
// `is null` filter is evaluated against the value at the time of the write, so
// a second writer sees what the first one committed.
// ---------------------------------------------------------------------------

type Row = { trial_started_at: string | null } | undefined

function fakeProfiles(initial: Row, opts: { updateError?: { message: string; code?: string }; readError?: { message: string } } = {}) {
  let row = initial === undefined ? undefined : { ...initial }
  const writes: Record<string, unknown>[] = []
  const filters: [string, unknown][] = []

  const client = {
    from(_t: string) {
      return {
        update(values: Record<string, unknown>) {
          writes.push(values)
          const chain = {
            eq(col: string, val: unknown) { filters.push([col, val]); return chain },
            is(col: string, val: unknown) {
              filters.push([col, val])
              if (opts.updateError) {
                return Promise.resolve({ error: opts.updateError, count: null })
              }
              // The conditional write, evaluated NOW against committed state.
              const matches = row !== undefined && row[col as 'trial_started_at'] === val
              if (matches) row = { ...row, ...(values as { trial_started_at: string }) }
              return Promise.resolve({ error: null, count: matches ? 1 : 0 })
            },
          }
          return chain
        },
        select(_cols: string) {
          const chain = {
            eq(_col: string, _val: unknown) { return chain },
            maybeSingle() {
              if (opts.readError) return Promise.resolve({ data: null, error: opts.readError })
              return Promise.resolve({ data: row ?? null, error: null })
            },
          }
          return chain
        },
      }
    },
  }
  return { client, writes, filters, current: () => row }
}

afterEach(() => vi.restoreAllMocks())

// ---------------------------------------------------------------------------
// The latch itself
// ---------------------------------------------------------------------------

describe('startTrialIfUnstarted', () => {
  it('starts the trial on an account that has never had one', async () => {
    const { client, writes, current } = fakeProfiles({ trial_started_at: null })
    const at = new Date('2026-09-10T01:02:03.000Z')
    expect(await startTrialIfUnstarted(client as never, UID, at)).toBe('started')
    expect(writes).toEqual([{ trial_started_at: '2026-09-10T01:02:03.000Z' }])
    expect(current()?.trial_started_at).toBe('2026-09-10T01:02:03.000Z')
  })

  it('writes ONLY where trial_started_at is null — the whole safety property', async () => {
    const { client, filters } = fakeProfiles({ trial_started_at: null })
    await startTrialIfUnstarted(client as never, UID)
    expect(filters).toContainEqual(['id', UID])
    expect(filters).toContainEqual(['trial_started_at', null])
  })

  it('never restarts or extends a trial that is already running', async () => {
    // An existing user's start must not move. Every entry point can fire more
    // than once; a rolling timestamp would hand out an unbounded trial.
    const started = '2026-09-01T00:00:00.000Z'
    const { client, current } = fakeProfiles({ trial_started_at: started })
    const out = await startTrialIfUnstarted(client as never, UID, new Date('2026-09-10T00:00:00.000Z'))
    expect(out).toBe('already_started')
    expect(current()?.trial_started_at).toBe(started)
  })

  it('does not resurrect a LONG-expired trial either', async () => {
    // 'expired' and 'active' are the same thing to the latch: non-null.
    const started = '2020-01-01T00:00:00.000Z'
    const { client, current } = fakeProfiles({ trial_started_at: started })
    expect(await startTrialIfUnstarted(client as never, UID)).toBe('already_started')
    expect(current()?.trial_started_at).toBe(started)
  })

  it('two concurrent calls stamp exactly once, and agree on the value', async () => {
    // A double-clicked confirm link, or a retried callback. Both issue
    // `update ... where trial_started_at is null`; the second re-evaluates the
    // predicate against what the first committed and matches nothing.
    const { client, writes, current } = fakeProfiles({ trial_started_at: null })
    const a = new Date('2026-09-10T01:00:00.000Z')
    const b = new Date('2026-09-10T01:00:05.000Z')
    const [r1, r2] = await Promise.all([
      startTrialIfUnstarted(client as never, UID, a),
      startTrialIfUnstarted(client as never, UID, b),
    ])
    expect([r1, r2].filter((r) => r === 'started')).toHaveLength(1)
    expect([r1, r2].filter((r) => r === 'already_started')).toHaveLength(1)
    // Two writes were ATTEMPTED; only one landed, and the row holds one value.
    expect(writes).toHaveLength(2)
    expect([a.toISOString(), b.toISOString()]).toContain(current()?.trial_started_at)
  })

  // -- the silent failure this is meant to make loud -------------------------

  it('LOGS when a user holding a session has no profile row at all', async () => {
    // The worst outcome available here: a new account quietly on Free, with no
    // error, no 500 and nothing the user can see. It must not pass silently.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = fakeProfiles(undefined)
    expect(await startTrialIfUnstarted(client as never, UID)).toBe('no_row')
    expect(spy).toHaveBeenCalled()
    expect(String(spy.mock.calls[0][0])).toContain('startTrial')
  })

  it('LOGS when the write matched nothing yet the column is still null', async () => {
    // A zero-row write whose re-read still says null is a permission/RLS
    // problem, not a race — a race would have left a value behind.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // The pathological shape the fake cannot produce on its own: the update
    // reports 0 rows AND the re-read says the column is still null.
    const broken = {
      from() {
        return {
          update() {
            const chain = {
              eq() { return chain },
              is() { return Promise.resolve({ error: null, count: 0 }) },
            }
            return chain
          },
          select() {
            const chain = {
              eq() { return chain },
              maybeSingle() { return Promise.resolve({ data: { trial_started_at: null }, error: null }) },
            }
            return chain
          },
        }
      },
    }
    expect(await startTrialIfUnstarted(broken as never, UID)).toBe('failed')
    expect(spy).toHaveBeenCalled()
  })

  it('swallows a database error rather than failing the signup', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = fakeProfiles({ trial_started_at: null }, {
      updateError: { message: 'connection reset', code: '08006' },
    })
    expect(await startTrialIfUnstarted(client as never, UID)).toBe('failed')
  })

  it('swallows a REJECTED promise too, not just a returned error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const throwing = { from() { return { update() { throw new Error('boom') } } } }
    await expect(startTrialIfUnstarted(throwing as never, UID)).resolves.toBe('failed')
  })

  it('reports "failed" rather than guessing when the confirming read errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = fakeProfiles({ trial_started_at: '2026-01-01T00:00:00.000Z' }, {
      readError: { message: 'timeout' },
    })
    expect(await startTrialIfUnstarted(client as never, UID)).toBe('failed')
  })

  it('has no throw path — a signup can never fail because of it', async () => {
    const src = read('app/src/lib/server/trial-start.ts')
    const code = src.slice(src.indexOf('export async function startTrialIfUnstarted'))
    expect(code).toContain('try {')
    expect(code).toContain('} catch (err) {')
    expect(code).not.toMatch(/^\s*throw /m)
  })
})

// ---------------------------------------------------------------------------
// The three entry points — one per way a session can first appear
// ---------------------------------------------------------------------------

describe('every path that mints a first session starts the trial', () => {
  const authSrc = () => read('app/src/app/actions/auth.ts')
  const confirmSrc = () => read('app/src/app/auth/confirm/route.ts')
  const callbackSrc = () => read('app/src/app/auth/callback/route.ts')

  it('confirmation OFF: signUp starts it when GoTrue hands back a session', () => {
    const src = authSrc()
    const signUp = src.slice(src.indexOf('export async function signUp'))
    const next = signUp.indexOf('export async function', 1)
    const body = signUp.slice(0, next)
    // Gated on the session, not on the user: with confirmation ON there is a
    // user and no session here, and stamping then would be the bug this change
    // exists to remove.
    expect(body).toMatch(/if \(data\.session\) \{\s*\n\s*await startTrialIfUnstarted\(createServiceClient\(\), data\.user\.id\)/)
  })

  it('confirmation ON: /auth/confirm starts it when the link is redeemed', () => {
    const src = confirmSrc()
    expect(src).toContain('startTrialIfUnstarted(createServiceClient(), userId)')
    expect(src).toContain('onSession:')
  })

  it('Google OAuth: /auth/callback starts it too', () => {
    // The path that gets forgotten. `signup_completed` had no OAuth emitter for
    // months for exactly this reason; a trial that only email signups received
    // would be the same omission with a bigger blast radius.
    const src = callbackSrc()
    expect(src).toContain('startTrialIfUnstarted(svc, data.user.id)')
    expect(src).toContain('isFreshAccount(data.user.created_at, now)')
  })

  it('the password LOGIN path does not start a trial', () => {
    // signIn mints a session on every login. A latch call there would arm a
    // trial for the accounts 0041's backfill deliberately left null.
    const src = authSrc()
    const signIn = src.slice(src.indexOf('export async function signIn'))
    const next = signIn.indexOf('export async function', 1)
    expect(signIn.slice(0, next)).not.toContain('startTrialIfUnstarted')
  })

  it('/auth/reset does not start a trial', () => {
    // A password-recovery grant is a session for an existing account.
    expect(read('app/src/app/auth/reset/route.ts')).not.toContain('startTrial')
  })

  it('a returning Google user is excluded by the freshness test', () => {
    const now = Date.parse('2026-09-10T12:00:00.000Z')
    const fresh = new Date(now - 2_000).toISOString()
    const old = new Date(now - 400 * 24 * 3600_000).toISOString()
    expect(isFreshAccount(fresh, now)).toBe(true)
    expect(isFreshAccount(old, now)).toBe(false)
    // Just outside the window is a login, not a signup.
    expect(isFreshAccount(new Date(now - OAUTH_SIGNUP_WINDOW_MS - 1000).toISOString(), now)).toBe(false)
  })

  it('an email_change grant at /auth/confirm does not start a trial', () => {
    // It is a grant redeemed by an account that already exists. Stamping there
    // could arm the wall on an internal account or a churned subscriber.
    const src = confirmSrc()
    const start = src.indexOf('function grantStartsTrial')
    const fn = src.slice(start, src.indexOf('\n}', start))
    expect(fn).toContain("'signup'")
    expect(fn).toContain("'invite'")
    // `expectTypes` below is deliberately broader than this — a grant may be
    // REDEEMED here without starting a trial.
    expect(fn).not.toContain("'email_change'")
    expect(fn).not.toContain("'magiclink'")
    expect(src).toContain("expectTypes: ['signup', 'invite', 'magiclink', 'email_change']")
  })
})

// ---------------------------------------------------------------------------
// The migration, and the deploy order it depends on
// ---------------------------------------------------------------------------

describe('migration 0074', () => {
  const sql = () => read('app/supabase/migrations/0074_trial_starts_at_confirmation.sql')

  it('removes trial_started_at from the signup trigger', () => {
    const s = sql()
    expect(s).toContain('create or replace function public.handle_new_user()')
    expect(s).toContain('insert into public.profiles (id, username, display_name, avatar_url)')
    // The column must not appear in the INSERT any more.
    const fn = s.slice(s.indexOf('create or replace function'))
    expect(fn).not.toMatch(/insert into public\.profiles \([^)]*trial_started_at/)
  })

  it('keeps the OAuth metadata capture 0008 added', () => {
    // 0041 carried this warning and it still applies: dropping these two
    // silently breaks Google sign-up's display name and avatar.
    const s = sql()
    expect(s).toContain("new.raw_user_meta_data->>'full_name'")
    expect(s).toContain("new.raw_user_meta_data->>'avatar_url'")
    expect(s).toContain("new.raw_user_meta_data->>'picture'")
  })

  it('moves no existing user: no backfill, no UPDATE, no default', () => {
    const statements = sql()
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n')
    expect(statements).not.toMatch(/\bupdate\s+public\.profiles\b/i)
    expect(statements).not.toMatch(/\bdefault\s+now\(\)/i)
    expect(statements).not.toMatch(/\bdrop\s+column\b/i)
  })

  it('states the code-first ordering the change depends on', () => {
    expect(sql()).toMatch(/APPLY THIS \*AFTER\* THE CODE/)
  })
})

// ---------------------------------------------------------------------------
// Nothing about the trial's shape changed
// ---------------------------------------------------------------------------

describe('the trial itself is unchanged — only when it starts', () => {
  it('is still 14 days, and still grants Pro while active', () => {
    expect(TRIAL_DAYS).toBe(14)
    const start = '2026-09-10T00:00:00.000Z'
    expect(trialState(start, null, new Date('2026-09-20T00:00:00.000Z'))).toBe('active')
    expect(trialState(start, null, new Date('2026-09-25T00:00:00.000Z'))).toBe('expired')
    expect(trialDaysLeft(start, new Date('2026-09-10T00:00:00.000Z'))).toBe(14)
  })

  it('null still means "never on a trial", never "walled"', () => {
    // The fail-open value, and now also the state a confirmed-pending account
    // sits in. It must stay harmless.
    expect(trialState(null, null, new Date())).toBe('none')
    expect(trialDaysLeft(null, new Date())).toBe(0)
  })

  it('a later start shifts the in-trial email sequence with it, by design', () => {
    // trial_email_stage (0064) keys off trial_started_at, so days 1/7/12 move
    // with the trial. That is the point — the sequence should track the trial
    // the user is actually having.
    const sequence = read('app/src/lib/trial-sequence.ts')
    expect(sequence).toContain('trial')
    expect(read('app/supabase/migrations/0064_trial_sequence.sql'))
      .toContain('trial_started_at')
  })
})
