import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import {
  LEGAL_DOCUMENTS, LEGAL_DOC_KEYS, LEGAL_VERSION,
  normaliseLegalBody, publishedVersion,
} from '@/lib/legal-versions'
import {
  TERMS_MECHANISMS, termsAcceptancePatch, stripeTermsConsent,
} from '@/lib/terms-acceptance'
import { recordTermsAcceptance } from '@/lib/server/terms-acceptance'

// repo root is three levels up from app/tests/unit
const ROOT = join(__dirname, '..', '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16)

const UID = '11111111-1111-4111-8111-111111111111'

// ---------------------------------------------------------------------------
// The version identifier — and the guard that stops it going stale
// ---------------------------------------------------------------------------

describe('legal document versions', () => {
  it('records a version for every document the consent surfaces name', () => {
    // Both surfaces name Terms, Privacy Policy and financial disclaimer. The
    // record must cover exactly what the user was shown — no more (that would
    // claim acceptance of an unseen document) and no less.
    expect([...LEGAL_DOC_KEYS]).toEqual(['terms', 'privacy', 'disclaimer'])

    const checkbox = read('app/src/app/signup/SignupForm.tsx')
    const notice = read('app/src/app/_components/LegalNotice.tsx')
    for (const surface of [checkbox, notice]) {
      expect(surface).toContain('LEGAL.terms')
      expect(surface).toContain('LEGAL.privacy')
      expect(surface).toContain('LEGAL.disclaimer')
    }
  })

  it('builds the stored version string from the table, so it cannot drift', () => {
    expect(LEGAL_VERSION).toBe(
      'terms=2026-08-18,privacy=2026-08-18,disclaimer=2026-06-24',
    )
    // Derived, not hand-written: rebuild it the same way and compare.
    expect(LEGAL_VERSION).toBe(
      LEGAL_DOC_KEYS.map((k) => `${k}=${LEGAL_DOCUMENTS[k].version}`).join(','),
    )
  })

  for (const key of LEGAL_DOC_KEYS) {
    const doc = LEGAL_DOCUMENTS[key]

    it(`${doc.file}: the recorded version IS the document's own "Last updated" date`, () => {
      // If this fails, someone changed the date on the page without telling the
      // acceptance record. Sync LEGAL_DOCUMENTS.
      expect(publishedVersion(read(doc.file))).toBe(doc.version)
    })

    it(`${doc.file}: the body has not changed under a version that stayed still`, () => {
      // ── IF THIS TEST FAILS ────────────────────────────────────────────────
      // You edited the words of a legal document. That is fine — but the
      // acceptance records written from now on must not claim users accepted a
      // version that no longer says what it said. Do BOTH of these, together:
      //   1. bump `version` in lib/legal-versions.ts AND the "Last updated"
      //      line in the HTML to today;
      //   2. paste the new hash the failure prints into `bodyHash`.
      // Updating only (2) makes the test pass and the evidence a lie.
      //
      // Reformatting, editing a comment, or changing anything outside
      // <main class="legal"> does NOT reach this hash — see normaliseLegalBody.
      const body = normaliseLegalBody(read(doc.file))
      expect(body, `${doc.file} has no <main class="legal"> body`).not.toBeNull()
      expect(hash(body as string)).toBe(doc.bodyHash)
    })
  }

  it('normaliseLegalBody ignores chrome, comments, whitespace and the date line', () => {
    const page = (extra: string, updated: string) => `
      <header>nav ${extra}</header>
      <main class="legal">
        <h1>Terms</h1>
        <p class="legal-updated">Last updated: ${updated}</p>
        <!-- an editorial comment ${extra} -->
        <p>You    agree to
        the thing.</p>
      </main>
      <footer>${extra}</footer>`

    const a = normaliseLegalBody(page('pixel-v1', '18 August 2026'))
    const b = normaliseLegalBody(page('pixel-v2', '1 January 2027'))
    expect(a).toBe(b)
    expect(a).toBe('<h1>Terms</h1> <p>You agree to the thing.</p>')
  })

  it('normaliseLegalBody returns null rather than hashing nothing', () => {
    // A silent empty-string hash would be a guard that always passes.
    expect(normaliseLegalBody('<main>not the legal one</main>')).toBeNull()
  })

  it('publishedVersion parses the human date the page actually prints', () => {
    expect(publishedVersion('<p>Last updated: 5 March 2027</p>')).toBe('2027-03-05')
    expect(publishedVersion('<p>Last updated: 18 August 2026</p>')).toBe('2026-08-18')
    expect(publishedVersion('<p>no date here</p>')).toBeNull()
    expect(publishedVersion('<p>Last updated: 3 Smarch 2027</p>')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The patch — what actually gets written
// ---------------------------------------------------------------------------

describe('termsAcceptancePatch', () => {
  it('records when, what and how — never a bare timestamp', () => {
    const at = new Date('2026-08-19T02:04:05.000Z')
    expect(termsAcceptancePatch('signup_checkbox', at)).toEqual({
      terms_accepted_at: '2026-08-19T02:04:05.000Z',
      terms_accepted_version: LEGAL_VERSION,
      terms_accepted_via: 'signup_checkbox',
    })
  })

  it('keeps the two mechanisms distinct, and only those two', () => {
    // A boolean would flatten express consent (a ticked box that blocked the
    // submit) into passive consent (a notice that was shown). They are not
    // worth the same and the record must not pretend otherwise.
    expect([...TERMS_MECHANISMS]).toEqual(['signup_checkbox', 'oauth_notice'])
    const a = termsAcceptancePatch('signup_checkbox')
    const b = termsAcceptancePatch('oauth_notice')
    expect(a.terms_accepted_via).not.toBe(b.terms_accepted_via)
  })

  it('is enumerated identically in the migration CHECK constraint', () => {
    // The database is the last line of defence against an unrecognised
    // mechanism; drift between the two would let one through.
    const sql = read('app/supabase/migrations/0060_terms_acceptance.sql')
    for (const m of TERMS_MECHANISMS) expect(sql).toContain(`'${m}'`)
    expect(sql).toContain('profiles_terms_accepted_via_check')
    // And all-three-or-none, so a timestamp can never sit there without a version.
    expect(sql).toContain('num_nonnulls(terms_accepted_at, terms_accepted_version, terms_accepted_via)')
  })
})

// ---------------------------------------------------------------------------
// recordTermsAcceptance — write-once, and inert before the migration
// ---------------------------------------------------------------------------

type FakeResult = { error?: { message: string; code?: string }; count?: number }

function fakeProfiles(result: FakeResult) {
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
              return Promise.resolve({ error: result.error ?? null, count: result.count ?? 0 })
            },
          }
          return chain
        },
      }
    },
  }
  return { client, writes, filters }
}

describe('recordTermsAcceptance', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('records the acceptance on the email path with the checkbox mechanism', async () => {
    const { client, writes } = fakeProfiles({ count: 1 })
    const out = await recordTermsAcceptance(client as never, UID, 'signup_checkbox')
    expect(out).toBe('recorded')
    expect(writes[0].terms_accepted_via).toBe('signup_checkbox')
    expect(writes[0].terms_accepted_version).toBe(LEGAL_VERSION)
    expect(typeof writes[0].terms_accepted_at).toBe('string')
  })

  it('records the OAuth path as passive consent, not as a checkbox', async () => {
    const { client, writes } = fakeProfiles({ count: 1 })
    const out = await recordTermsAcceptance(client as never, UID, 'oauth_notice')
    expect(out).toBe('recorded')
    expect(writes[0].terms_accepted_via).toBe('oauth_notice')
  })

  it('is write-once: it only ever touches a row whose acceptance is still null', async () => {
    // /auth/callback runs on EVERY Google sign-in. Without this filter the
    // timestamp would roll forward to the latest login and the moment the
    // contract was formed would be lost — and an oauth_notice could overwrite
    // a stronger signup_checkbox record.
    const { client, filters } = fakeProfiles({ count: 1 })
    await recordTermsAcceptance(client as never, UID, 'oauth_notice')
    expect(filters).toContainEqual(['id', UID])
    expect(filters).toContainEqual(['terms_accepted_at', null])
  })

  it('reports "unchanged" and writes nothing new when an acceptance already exists', async () => {
    const { client } = fakeProfiles({ count: 0 })
    expect(await recordTermsAcceptance(client as never, UID, 'oauth_notice')).toBe('unchanged')
  })

  // -- inert without the migration ------------------------------------------

  for (const code of ['42703', 'PGRST204']) {
    it(`is INERT, not broken, when the column does not exist yet (${code})`, async () => {
      // The code ships before migration 0060 is applied. A throw here would
      // break signup for every new user, which is far worse than the finding.
      const { client } = fakeProfiles({ error: { message: 'no such column', code } })
      await expect(
        recordTermsAcceptance(client as never, UID, 'signup_checkbox'),
      ).resolves.toBe('not_migrated')
    })
  }

  it('swallows a genuine database error rather than failing the signup', async () => {
    const { client } = fakeProfiles({ error: { message: 'connection reset', code: '08006' } })
    await expect(
      recordTermsAcceptance(client as never, UID, 'signup_checkbox'),
    ).resolves.toBe('failed')
  })

  it('has no throw path at all — signup can never fail because of it', async () => {
    // Belt and braces alongside the cases below: the two callers do a bare
    // `await recordTermsAcceptance(...)` and ignore the result, so a throw here
    // would surface as a failed signup / a bounced OAuth callback.
    const src = read('app/src/lib/server/terms-acceptance.ts')
    const code = src.slice(src.indexOf('export async function recordTermsAcceptance'))
    expect(code).toContain('try {')
    expect(code).toContain('} catch (err) {')
    expect(code).not.toMatch(/^\s*throw /m)
  })

  it('swallows a REJECTED promise too, not just a returned error', async () => {
    // A returned { error } and a thrown exception are different code paths and
    // only one of them was covered by the case above.
    const client = { from() { return { update() { throw new Error('boom') } } } }
    await expect(
      recordTermsAcceptance(client as never, UID, 'signup_checkbox'),
    ).resolves.toBe('failed')
  })
})

// ---------------------------------------------------------------------------
// Existing users — null must stay null and must stay ambiguous
// ---------------------------------------------------------------------------

describe('existing accounts are left unknown, not fabricated', () => {
  it('the migration contains no backfill of any kind', () => {
    const sql = read('app/supabase/migrations/0060_terms_acceptance.sql')
    const statements = sql
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n')
    // Writing "accepted" for 457 users who were never shown a record would be
    // manufacturing evidence — the exact class of thing this audit removes.
    expect(statements).not.toMatch(/\bupdate\s+public\.profiles\b/i)
    expect(statements).not.toMatch(/\binsert\s+into\b/i)
    expect(statements).not.toMatch(/\bdefault\s+now\(\)/i)
  })

  it('the columns are nullable — no NOT NULL, no default', () => {
    const sql = read('app/supabase/migrations/0060_terms_acceptance.sql')
    expect(sql).toMatch(/add column if not exists terms_accepted_at\s+timestamptz,/)
    expect(sql).not.toMatch(/terms_accepted_at\s+timestamptz\s+not null/i)
  })

  it('no route, page, action or component touches the columns', () => {
    // NULL means UNKNOWN. The moment a surface gates on it, null silently
    // becomes "declined" for 457 people who were simply never asked. The
    // columns are written in lib/server and read by nothing; keep it that way
    // until someone decides, in writing, what null should mean.
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (/\.tsx?$/.test(e.name) && readFileSync(p, 'utf8').includes('terms_accepted_')) {
          hits.push(p.replace(/\\/g, '/').split('/app/src/')[1])
        }
      }
    }
    walk(join(ROOT, 'app', 'src', 'app'))
    expect(hits).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Checkout — Stripe's own record, behind a flag
// ---------------------------------------------------------------------------

describe('stripeTermsConsent', () => {
  it('is OFF unless explicitly switched on', () => {
    // Stripe rejects consent_collection when no ToS URL is set in the
    // Dashboard, and whether one is set is not knowable from this repo. Default
    // off means a deploy cannot turn every checkout into a 500.
    for (const v of [undefined, '', 'off', 'true', '1', 'yes']) {
      expect(stripeTermsConsent({ STRIPE_TOS_CONSENT: v })).toBeUndefined()
    }
  })

  it('asks Stripe for a required acceptance when switched on', () => {
    expect(stripeTermsConsent({ STRIPE_TOS_CONSENT: 'on' }))
      .toEqual({ terms_of_service: 'required' })
    expect(stripeTermsConsent({ STRIPE_TOS_CONSENT: 'ON' }))
      .toEqual({ terms_of_service: 'required' })
  })

  it('the checkout route passes it through, and the flag is documented', () => {
    const route = read('app/src/app/api/billing/checkout/route.ts')
    expect(route).toContain('consent_collection: stripeTermsConsent()')
    expect(read('app/.env.example')).toContain('STRIPE_TOS_CONSENT=')
  })

  it('does NOT duplicate Stripe\'s consent record into our database', () => {
    // Stripe timestamps the acceptance on the same object as the amount, the
    // price and the card. Copying it here would add nothing and invite the two
    // copies to disagree.
    const webhook = read('app/src/app/api/stripe/webhook/route.ts')
    expect(webhook).not.toContain('terms_accepted')
    expect(webhook).not.toContain('terms_of_service')
    // (`ads_consent` in that file is the advertising cookie choice from item
    // 17, an unrelated thing that happens to share the word.)
  })
})

// ---------------------------------------------------------------------------
// Both paths are actually wired
// ---------------------------------------------------------------------------

describe('both signup paths write a record', () => {
  it('the email path records the checkbox it already enforced', () => {
    const auth = read('app/src/app/actions/auth.ts')
    // The enforcement that existed and left no trace.
    expect(auth).toContain("if (!terms) return")
    expect(auth).toContain("recordTermsAcceptance(createServiceClient(), data.user.id, 'signup_checkbox')")
  })

  it('the email path\'s checkbox actually gates the submit button', () => {
    // What makes this record "express consent" rather than passive is that the
    // box had to be ticked before the button would go. The button used to
    // ignore `agreed` entirely, so the control looked mandatory and was not —
    // the server rejected it, but only after a round-trip.
    const form = read('app/src/app/signup/SignupForm.tsx')
    const disabled = form.match(/<button disabled=\{([^}]*)\} className="fl-submit"/)
    expect(disabled, 'could not find the fl-submit button').not.toBeNull()
    expect((disabled as RegExpMatchArray)[1]).toContain('!agreed')
    // And the reason is stated inline in the same style as the password error,
    // so a disabled button is never unexplained.
    expect(form).toContain('!problem && pw && !agreed')
  })

  it('the Google path records the notice it now shows', () => {
    const cb = read('app/src/app/auth/callback/route.ts')
    expect(cb).toContain("recordTermsAcceptance(createServiceClient(), data.user.id, 'oauth_notice')")
  })

  it('nothing records an acceptance on the password login path', () => {
    // /login's email form shows no notice, so there is nothing to record. A
    // write there would be an acceptance the user never gave.
    const auth = read('app/src/app/actions/auth.ts')
    const signIn = auth.slice(auth.indexOf('export async function signIn'))
    const nextExport = signIn.indexOf('export async function', 1)
    expect(signIn.slice(0, nextExport)).not.toContain('recordTermsAcceptance')
  })
})
