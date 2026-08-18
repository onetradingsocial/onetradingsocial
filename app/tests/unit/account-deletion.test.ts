import { describe, it, expect, vi, afterEach } from 'vitest'
import { BUCKET, PRIVATE_BUCKET } from '@/lib/storage'
import {
  DELETION_ORDER, runDeletionSteps, deletionErrorMessage, isUserOwnedKey,
  userStoragePrefixes, stripeCloseoutPlan, TERMINAL_SUB_STATUSES, THIRD_PARTY_RESIDUE,
  type DeletionStep,
} from '@/lib/account-deletion'
import {
  purgeUserStorage, scrubAnalytics, preserveModerationRecords,
  pseudonymiseAdminAudit,
} from '@/lib/server/account-deletion'

const UID = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'

// ---------------------------------------------------------------------------
// Ordering — the invariant the whole design rests on
// ---------------------------------------------------------------------------

describe('DELETION_ORDER', () => {
  it('puts every external service before the local delete', () => {
    // Each of these holds a handle that the auth.users delete cascades away.
    // Running them after it means never running them at all (F6.3, F6.4, F6.2).
    const authAt = DELETION_ORDER.indexOf('auth')
    for (const step of ['stripe', 'metaapi', 'storage', 'analytics', 'moderation'] as const) {
      expect(DELETION_ORDER.indexOf(step)).toBeLessThan(authAt)
    }
  })

  it('makes the local delete the very last step', () => {
    expect(DELETION_ORDER[DELETION_ORDER.length - 1]).toBe('auth')
  })

  it('cancels billing before anything else can abort the run', () => {
    // Stripe is the only step whose failure costs the user money, so it must
    // be the first thing attempted while the account is still fully intact.
    expect(DELETION_ORDER[0]).toBe('stripe')
  })

  it('scrubs analytics before the cascade nulls the user_id handle', () => {
    expect(DELETION_ORDER.indexOf('analytics')).toBeLessThan(DELETION_ORDER.indexOf('auth'))
  })
})

// ---------------------------------------------------------------------------
// runDeletionSteps — partial-failure behaviour
// ---------------------------------------------------------------------------

function recorder() {
  const calls: DeletionStep[] = []
  const ok = (step: DeletionStep) => async () => { calls.push(step); return { ok: true as const } }
  const fail = (step: DeletionStep, error = 'boom') => async () => {
    calls.push(step); return { ok: false as const, error }
  }
  return { calls, ok, fail }
}

describe('runDeletionSteps', () => {
  it('runs every step in DELETION_ORDER when all succeed', async () => {
    const r = recorder()
    const run = await runDeletionSteps(Object.fromEntries(
      DELETION_ORDER.map((s) => [s, r.ok(s)]),
    ))
    expect(run.ok).toBe(true)
    expect(run.failedAt).toBeUndefined()
    expect(r.calls).toEqual([...DELETION_ORDER])
    expect(run.results.every((x) => x.ok)).toBe(true)
  })

  it('STOPS at the first failure and never reaches the auth delete', async () => {
    // The heart of F6.12: the account must survive a partial failure, not be
    // half-erased. If storage cannot be cleared, auth.users must stay put --
    // otherwise the DB rows naming the leftover objects are gone too and
    // nothing can ever enumerate them again.
    const r = recorder()
    const run = await runDeletionSteps({
      stripe: r.ok('stripe'),
      metaapi: r.ok('metaapi'),
      storage: r.fail('storage', 'list failed'),
      analytics: r.ok('analytics'),
      moderation: r.ok('moderation'),
      auth: r.ok('auth'),
    })
    expect(run.ok).toBe(false)
    expect(run.failedAt).toBe('storage')
    expect(r.calls).toEqual(['stripe', 'metaapi', 'storage'])
    expect(r.calls).not.toContain('auth')
  })

  it('aborts on the FIRST step without touching anything else', async () => {
    const r = recorder()
    const run = await runDeletionSteps({
      stripe: r.fail('stripe', 'card processor down'),
      metaapi: r.ok('metaapi'),
      storage: r.ok('storage'),
      analytics: r.ok('analytics'),
      moderation: r.ok('moderation'),
      auth: r.ok('auth'),
    })
    expect(run.failedAt).toBe('stripe')
    expect(r.calls).toEqual(['stripe'])
    expect(run.results).toHaveLength(1)
  })

  it('reports what DID succeed before the abort, so a retry is informed', async () => {
    const r = recorder()
    const run = await runDeletionSteps({
      stripe: r.ok('stripe'),
      metaapi: r.fail('metaapi', 'metaapi timed out'),
      auth: r.ok('auth'),
    })
    expect(run.results.filter((x) => x.ok).map((x) => x.step)).toEqual(['stripe'])
    expect(run.results.find((x) => !x.ok)?.error).toBe('metaapi timed out')
  })

  it('treats a thrown step as a failure rather than crashing the action', async () => {
    // An unhandled rejection here reaches the user as the generic Next.js
    // error page, with no admin_audit row and no idea how far it got.
    const r = recorder()
    const run = await runDeletionSteps({
      stripe: r.ok('stripe'),
      storage: async () => { throw new Error('network') },
      auth: r.ok('auth'),
    })
    expect(run.ok).toBe(false)
    expect(run.failedAt).toBe('storage')
    expect(run.results.at(-1)?.error).toBe('network')
    expect(r.calls).not.toContain('auth')
  })

  it('skips steps that are not supplied without treating them as failures', async () => {
    // A user with no Stripe customer and no broker supplies neither step.
    const r = recorder()
    const run = await runDeletionSteps({ storage: r.ok('storage'), auth: r.ok('auth') })
    expect(run.ok).toBe(true)
    expect(r.calls).toEqual(['storage', 'auth'])
  })

  it('carries step detail through to the audit record', async () => {
    const run = await runDeletionSteps({
      stripe: async () => ({ ok: true, detail: { cancelled: 2, customer: 'retained_for_tax_record' } }),
    }, ['stripe'])
    expect(run.results[0].detail).toEqual({ cancelled: 2, customer: 'retained_for_tax_record' })
  })
})

describe('deletionErrorMessage', () => {
  it('has a distinct message for every step', () => {
    const seen = new Set(DELETION_ORDER.map((s) => deletionErrorMessage(s)))
    expect(seen.size).toBe(DELETION_ORDER.length)
  })

  it('tells the user their account is untouched when an early step aborts', () => {
    for (const step of ['stripe', 'metaapi', 'storage', 'analytics', 'moderation'] as const) {
      expect(deletionErrorMessage(step).toLowerCase()).toContain('untouched')
    }
  })

  it('does NOT claim the account is untouched once the auth delete is the failure', () => {
    // Everything external is already done at that point; saying "untouched"
    // would be a lie about a cancelled subscription and deleted images.
    expect(deletionErrorMessage('auth').toLowerCase()).not.toContain('untouched')
  })

  it('reassures about money when the payment step is the one that failed', () => {
    expect(deletionErrorMessage('stripe').toLowerCase()).toContain('charged')
  })
})

// ---------------------------------------------------------------------------
// isUserOwnedKey — the guard that stops deletion escaping its own namespace
// ---------------------------------------------------------------------------

describe('isUserOwnedKey', () => {
  it('accepts the folder shapes, uid at index 2 (matches 0044 storage RLS)', () => {
    expect(isUserOwnedKey(`trades/${UID}/abc.png`, UID)).toBe(true)
    expect(isUserOwnedKey(`messages/${UID}/draft-1/0.jpg`, UID)).toBe(true)
    expect(isUserOwnedKey(`posts/${UID}/post-1/2.png`, UID)).toBe(true)
  })

  it('accepts the flat avatar/cover shapes that have no uid folder', () => {
    expect(isUserOwnedKey(`avatars/${UID}.png`, UID)).toBe(true)
    expect(isUserOwnedKey(`covers/${UID}.jpg`, UID)).toBe(true)
  })

  it('REJECTS another user in every shape', () => {
    expect(isUserOwnedKey(`trades/${OTHER}/abc.png`, UID)).toBe(false)
    expect(isUserOwnedKey(`avatars/${OTHER}.png`, UID)).toBe(false)
    expect(isUserOwnedKey(`messages/${OTHER}/d/0.jpg`, UID)).toBe(false)
  })

  it('rejects a uid that is merely a PREFIX of the filename', () => {
    // The avatars folder is shared by the whole platform and `search` is a
    // substring match, so "close enough" has to mean "not this user".
    expect(isUserOwnedKey(`avatars/${UID}-old.png`, UID)).toBe(false)
    expect(isUserOwnedKey(`avatars/${UID}extra.png`, UID)).toBe(false)
    expect(isUserOwnedKey(`trades/${UID}x/a.png`, UID)).toBe(false)
  })

  it('rejects traversal and absolute keys', () => {
    expect(isUserOwnedKey(`trades/${UID}/../${OTHER}/a.png`, UID)).toBe(false)
    expect(isUserOwnedKey(`/trades/${UID}/a.png`, UID)).toBe(false)
  })

  it('rejects degenerate input rather than defaulting to true', () => {
    expect(isUserOwnedKey('', UID)).toBe(false)
    expect(isUserOwnedKey(`avatars/${UID}.png`, '')).toBe(false)
    expect(isUserOwnedKey('avatars', UID)).toBe(false)
  })
})

describe('userStoragePrefixes', () => {
  it('sweeps BOTH buckets — the split from migration 0044', () => {
    const specs = userStoragePrefixes()
    expect(specs.filter((s) => s.bucket === 'public').map((s) => s.prefix).sort())
      .toEqual(['avatars', 'covers', 'posts'])
    expect(specs.filter((s) => s.bucket === 'private').map((s) => s.prefix).sort())
      .toEqual(['messages', 'trades'])
  })

  it('marks avatars and covers as filename matches, not folders', () => {
    const byPrefix = new Map(userStoragePrefixes().map((s) => [s.prefix, s.match]))
    expect(byPrefix.get('avatars')).toBe('filename')
    expect(byPrefix.get('covers')).toBe('filename')
    expect(byPrefix.get('trades')).toBe('folder')
  })
})

// ---------------------------------------------------------------------------
// Stripe closeout decision (F6.3)
// ---------------------------------------------------------------------------

describe('stripeCloseoutPlan', () => {
  it('cancels everything that is not already terminal', () => {
    const plan = stripeCloseoutPlan({
      subscriptions: [
        { id: 'sub_active', status: 'active' },
        { id: 'sub_pastdue', status: 'past_due' },
        { id: 'sub_trial', status: 'trialing' },
        { id: 'sub_unpaid', status: 'unpaid' },
      ],
      hasBillingHistory: true,
    })
    expect(plan.cancel).toEqual(['sub_active', 'sub_pastdue', 'sub_trial', 'sub_unpaid'])
  })

  it('skips subscriptions there is nothing left to cancel on', () => {
    const plan = stripeCloseoutPlan({
      subscriptions: [
        { id: 'sub_gone', status: 'canceled' },
        { id: 'sub_dead', status: 'incomplete_expired' },
      ],
      hasBillingHistory: false,
    })
    expect(plan.cancel).toEqual([])
    for (const s of ['canceled', 'incomplete_expired']) expect(TERMINAL_SUB_STATUSES.has(s)).toBe(true)
  })

  it('KEEPS the customer whenever any billing history exists', () => {
    // Item 6 Part 3: Stripe's invoices are the AU tax record (ITAA 1936
    // s262A). customers.del strips the name/email off them, which destroys
    // the part that explains who the transaction was with while retaining the
    // number -- worse for tax, no better for privacy.
    expect(stripeCloseoutPlan({ subscriptions: [], hasBillingHistory: true }).deleteCustomer).toBe(false)
  })

  it('deletes a customer that never transacted', () => {
    // An abandoned checkout leaves a customer object with no invoice and no
    // charge. Nothing to keep, so it goes.
    expect(stripeCloseoutPlan({ subscriptions: [], hasBillingHistory: false }).deleteCustomer).toBe(true)
  })

  it('still cancels a live subscription on a customer being kept', () => {
    const plan = stripeCloseoutPlan({
      subscriptions: [{ id: 'sub_1', status: 'active' }],
      hasBillingHistory: true,
    })
    expect(plan.cancel).toEqual(['sub_1'])
    expect(plan.deleteCustomer).toBe(false)
  })
})

describe('THIRD_PARTY_RESIDUE', () => {
  it('names every recipient we cannot delete from, with a route for the user', () => {
    expect(THIRD_PARTY_RESIDUE.map((r) => r.name))
      .toEqual(['Stripe', 'Meta (Facebook)', 'Reddit', 'Google Analytics', 'Resend'])
    for (const r of THIRD_PARTY_RESIDUE) {
      expect(r.holds.length).toBeGreaterThan(10)
      expect(r.removal.length).toBeGreaterThan(10)
    }
  })
})

// ---------------------------------------------------------------------------
// Storage purge (F6.2)
// ---------------------------------------------------------------------------

type FakeBuckets = Record<string, string[]>

function fakeStorage(buckets: FakeBuckets, opts: { failList?: string; failRemove?: string } = {}) {
  const removed: Record<string, string[]> = {}
  const removeCalls: number[] = []
  const client = {
    storage: {
      from(bucket: string) {
        return {
          async list(prefix: string, o: { limit: number; offset?: number; search?: string }) {
            if (opts.failList === bucket) return { data: null, error: { message: 'list exploded' } }
            const keys = buckets[bucket] ?? []
            const seen = new Map<string, { name: string; id: string | null }>()
            for (const key of keys) {
              if (!key.startsWith(`${prefix}/`)) continue
              const rest = key.slice(prefix.length + 1)
              const first = rest.split('/')[0]
              const isFolder = rest.includes('/')
              if (!seen.has(first)) seen.set(first, { name: first, id: isFolder ? null : 'obj' })
            }
            let entries = [...seen.values()]
            if (o.search) entries = entries.filter((e) => e.name.includes(o.search!))
            const start = o.offset ?? 0
            return { data: entries.slice(start, start + o.limit), error: null }
          },
          async remove(paths: string[]) {
            if (opts.failRemove === bucket) return { data: null, error: { message: 'remove denied' } }
            removeCalls.push(paths.length)
            removed[bucket] = [...(removed[bucket] ?? []), ...paths]
            return { data: [], error: null }
          },
        }
      },
    },
  }
  return { client, removed, removeCalls }
}

describe('purgeUserStorage', () => {
  // Taken from the module rather than hardcoded. The bucket names are
  // module-level consts read from the environment at import time, so stubbing
  // the env in a test would do nothing -- and hardcoding the defaults would
  // make this suite fail on any machine that sets NEXT_PUBLIC_SUPABASE_BUCKET.
  const PUB = BUCKET
  const PRIV = PRIVATE_BUCKET

  it('clears the user from both buckets, including nested folders', async () => {
    const { client, removed } = fakeStorage({
      [PUB]: [
        `avatars/${UID}.png`,
        `covers/${UID}.jpg`,
        `posts/${UID}/post-a/0.png`,
        `posts/${UID}/post-a/1.png`,
        `posts/${UID}/post-b/0.png`,
      ],
      [PRIV]: [
        `trades/${UID}/trade-1.png`,
        `messages/${UID}/draft-1/0.png`,
        `messages/${UID}/draft-2/0.png`,
      ],
    })
    const out = await purgeUserStorage(client as never, UID)
    expect(out).toMatchObject({ ok: true, detail: { removed: 8 } })
    expect(removed[PUB].sort()).toEqual([
      `avatars/${UID}.png`, `covers/${UID}.jpg`,
      `posts/${UID}/post-a/0.png`, `posts/${UID}/post-a/1.png`, `posts/${UID}/post-b/0.png`,
    ].sort())
    expect(removed[PRIV]).toHaveLength(3)
  })

  it('never touches another user in the shared avatars and covers folders', async () => {
    // The regression that would end the company: `avatars/` holds every user's
    // avatar side by side, so a listing bug here deletes the whole platform's.
    const { client, removed } = fakeStorage({
      [PUB]: [
        `avatars/${UID}.png`, `avatars/${OTHER}.png`,
        `covers/${UID}.png`, `covers/${OTHER}.png`,
        `posts/${OTHER}/p/0.png`,
      ],
      [PRIV]: [`trades/${OTHER}/t.png`],
    })
    const out = await purgeUserStorage(client as never, UID)
    expect(out.ok).toBe(true)
    expect(removed[PUB].sort()).toEqual([`avatars/${UID}.png`, `covers/${UID}.png`])
    expect(removed[PRIV]).toBeUndefined()
  })

  it('rejects a foreign key even if the enumeration hands one over', async () => {
    // Simulates a listing bug / API shape change: the fake returns the whole
    // avatars folder for a uid-shaped search. isUserOwnedKey is the backstop.
    const { client, removed } = fakeStorage({
      [PUB]: [`avatars/${UID}.png`, `avatars/${UID}-backup.png`],
      [PRIV]: [],
    })
    const out = await purgeUserStorage(client as never, UID)
    expect(out.ok).toBe(true)
    expect(removed[PUB]).toEqual([`avatars/${UID}.png`])
  })

  it('succeeds with nothing to do for an account that never uploaded', async () => {
    const { client, removed } = fakeStorage({ [PUB]: [], [PRIV]: [] })
    const out = await purgeUserStorage(client as never, UID)
    expect(out).toMatchObject({ ok: true, detail: { removed: 0 } })
    expect(removed).toEqual({})
  })

  it('fails the step when a list errors — it must not report success on a partial sweep', async () => {
    const { client } = fakeStorage(
      { [PUB]: [`avatars/${UID}.png`], [PRIV]: [`trades/${UID}/t.png`] },
      { failList: PRIV },
    )
    const out = await purgeUserStorage(client as never, UID)
    expect(out.ok).toBe(false)
    expect((out as { error: string }).error).toContain('list')
  })

  it('fails the step when a remove errors', async () => {
    const { client } = fakeStorage(
      { [PUB]: [`avatars/${UID}.png`], [PRIV]: [] },
      { failRemove: PUB },
    )
    const out = await purgeUserStorage(client as never, UID)
    expect(out.ok).toBe(false)
    expect((out as { error: string }).error).toContain('remove')
  })

  it('batches large removals instead of one enormous call', async () => {
    const many = Array.from({ length: 250 }, (_, i) => `trades/${UID}/t${i}.png`)
    const { client, removeCalls } = fakeStorage({ [PUB]: [], [PRIV]: many })
    const out = await purgeUserStorage(client as never, UID)
    expect(out.ok).toBe(true)
    expect(removeCalls).toEqual([100, 100, 50])
  })
})

// ---------------------------------------------------------------------------
// Analytics de-identification (F6.5)
// ---------------------------------------------------------------------------

type Update = { table: string; values: Record<string, unknown>; filter: string; arg: unknown }

function fakeDb(fail: { table?: string } = {}) {
  const updates: Update[] = []
  const client = {
    from(table: string) {
      return {
        update(values: Record<string, unknown>, _o?: unknown) {
          const finish = (filter: string, arg: unknown) => {
            updates.push({ table, values, filter, arg })
            return Promise.resolve(
              fail.table === table
                ? { error: { message: `${table} write failed` }, count: null }
                : { error: null, count: 1 },
            )
          }
          return {
            eq: (_c: string, v: unknown) => finish('eq', v),
            in: (_c: string, v: unknown) => finish('in', v),
          }
        },
      }
    },
  }
  return { client, updates }
}

describe('scrubAnalytics', () => {
  it('nulls the re-linking key, not just the foreign key', () => {
    // SET NULL on user_id was already happening via the cascade; F6.5 is that
    // anon_id survived it and made the "anonymised" rows re-linkable.
    const { client, updates } = fakeDb()
    return scrubAnalytics(client as never, UID, ['anon-a']).then((out) => {
      expect(out.ok).toBe(true)
      const scrub = updates[0].values
      expect(scrub).toMatchObject({ user_id: null, anon_id: null, path: null, referrer: null })
      // Kept on purpose so the funnel stays usable once the rows are truly
      // aggregate: event, device, source, created_at.
      expect(scrub).not.toHaveProperty('event')
      expect(scrub).not.toHaveProperty('device')
      expect(scrub).not.toHaveProperty('source')
    })
  })

  it('reaches the PRE-LOGIN rows, which have no user_id to find them by', async () => {
    const { client, updates } = fakeDb()
    await scrubAnalytics(client as never, UID, ['anon-a', 'anon-b'])
    const analytics = updates.filter((u) => u.table === 'analytics_events')
    expect(analytics).toHaveLength(2)
    expect(analytics[0]).toMatchObject({ filter: 'eq', arg: UID })
    expect(analytics[1]).toMatchObject({ filter: 'in', arg: ['anon-a', 'anon-b'] })
  })

  it('scrubs the same identifier out of referral_clicks', async () => {
    const { client, updates } = fakeDb()
    await scrubAnalytics(client as never, UID, ['anon-a'])
    expect(updates.find((u) => u.table === 'referral_clicks')).toMatchObject({
      values: { anon_id: null }, filter: 'in', arg: ['anon-a'],
    })
  })

  it('skips the anon pass entirely when the user has no anon_id', async () => {
    const { client, updates } = fakeDb()
    const out = await scrubAnalytics(client as never, UID, [])
    expect(out.ok).toBe(true)
    expect(updates).toHaveLength(1)
  })

  it('FAILS the step when the analytics write fails', async () => {
    const { client } = fakeDb({ table: 'analytics_events' })
    const out = await scrubAnalytics(client as never, UID, ['anon-a'])
    expect(out.ok).toBe(false)
  })

  it('does NOT fail the deletion when only the P3 referral_clicks write fails', async () => {
    const { client } = fakeDb({ table: 'referral_clicks' })
    const out = await scrubAnalytics(client as never, UID, ['anon-a'])
    expect(out.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Moderation retention (F6.8) — inert without migration 0051
// ---------------------------------------------------------------------------

function fakeReports(result: { error?: { message: string; code?: string }; count?: number }) {
  const seen: Record<string, unknown>[] = []
  const client = {
    from(_t: string) {
      return {
        update(values: Record<string, unknown>) {
          seen.push(values)
          return { eq: () => Promise.resolve({ error: result.error ?? null, count: result.count ?? 0 }) }
        },
      }
    },
  }
  return { client, seen }
}

describe('preserveModerationRecords', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('stamps a salted hash of the EMAIL, not of the user id', async () => {
    // A hash of the uuid could never match a re-registration, because
    // re-registration mints a new uuid. The email is the identity that
    // persists, which is the entire point of the retention.
    vi.stubEnv('DELETION_HASH_SALT', 'pepper')
    const { client, seen } = fakeReports({ count: 2 })
    const out = await preserveModerationRecords(client as never, UID, 'Someone@Example.com')
    expect(out.ok).toBe(true)
    const hash = seen[0].reported_user_hash as string
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain(UID)

    // Case and whitespace are normalised, so the same person hashes the same
    // however they typed their address at signup.
    const second = fakeReports({ count: 0 })
    await preserveModerationRecords(second.client as never, UID, '  someone@example.com ')
    expect(second.seen[0].reported_user_hash).toBe(hash)
  })

  it('produces a different hash under a different salt', async () => {
    vi.stubEnv('DELETION_HASH_SALT', 'salt-a')
    const a = fakeReports({ count: 0 })
    await preserveModerationRecords(a.client as never, UID, 'x@y.z')
    vi.stubEnv('DELETION_HASH_SALT', 'salt-b')
    const b = fakeReports({ count: 0 })
    await preserveModerationRecords(b.client as never, UID, 'x@y.z')
    expect(a.seen[0].reported_user_hash).not.toBe(b.seen[0].reported_user_hash)
  })

  it('writes NO hash at all rather than an unsalted one', async () => {
    // An unsalted SHA-256 of an email is a lookup, not a pseudonym. The report
    // row still survives via the migration's SET NULL either way.
    vi.stubEnv('DELETION_HASH_SALT', '')
    const { client, seen } = fakeReports({ count: 0 })
    const out = await preserveModerationRecords(client as never, UID, 'x@y.z')
    expect(out.ok).toBe(true)
    expect(out).toMatchObject({ detail: { skipped: 'no_salt' } })
    expect(seen).toHaveLength(0)
  })

  it('is INERT, not fatal, before migration 0051 adds the column', async () => {
    // Deploy order is code first, migration second. A P2 moderation nicety
    // running ahead of its schema must never abort a user's erasure.
    vi.stubEnv('DELETION_HASH_SALT', 'pepper')
    const { client } = fakeReports({ error: { message: 'column does not exist', code: '42703' } })
    const out = await preserveModerationRecords(client as never, UID, 'x@y.z')
    expect(out.ok).toBe(true)
    expect(out).toMatchObject({ detail: { skipped: 'no_hash_column' } })
  })

  it('fails the step on a real database error', async () => {
    vi.stubEnv('DELETION_HASH_SALT', 'pepper')
    const { client } = fakeReports({ error: { message: 'connection reset', code: '08006' } })
    const out = await preserveModerationRecords(client as never, UID, 'x@y.z')
    expect(out.ok).toBe(false)
  })

  it('is a no-op for an account with no email on file', async () => {
    vi.stubEnv('DELETION_HASH_SALT', 'pepper')
    const { client, seen } = fakeReports({ count: 0 })
    const out = await preserveModerationRecords(client as never, UID, null)
    expect(out.ok).toBe(true)
    expect(seen).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Audit item 18, F7 — the admin's own erasure right over the audit log.
// ---------------------------------------------------------------------------

/** admin_audit fake: update(...).eq(...).not(...) resolves. */
function fakeAudit(result: { error?: { message: string; code?: string }; count?: number }) {
  const seen: Record<string, unknown>[] = []
  const client = {
    from(_t: string) {
      return {
        update(values: Record<string, unknown>) {
          seen.push(values)
          const done = Promise.resolve({ error: result.error ?? null, count: result.count ?? 0 })
          return { eq: () => ({ not: () => done }) }
        },
      }
    },
  }
  return { client, seen }
}

describe('pseudonymiseAdminAudit (audit item 18, F7)', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('nulls the address and keeps a stable pseudonym', async () => {
    vi.stubEnv('DELETION_HASH_SALT', 'pepper')
    const { client, seen } = fakeAudit({ count: 3 })
    const out = await pseudonymiseAdminAudit(client as never, UID, 'admin@example.com')
    expect(out.ok).toBe(true)
    expect(seen[0].actor_email).toBeNull()
    expect(seen[0].actor_email_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(out).toMatchObject({ detail: { pseudonymised: 3 } })
  })

  it('reuses the WS3 pattern, not a second one — same salt, same input, same hash', async () => {
    // The point of reusing preserveModerationRecords' formula is that one
    // departed person carries ONE pseudonym across trade_reports and
    // admin_audit. If these two ever diverge, that property is gone and this
    // test is the thing that says so.
    vi.stubEnv('DELETION_HASH_SALT', 'pepper')
    const mod = fakeReports({ count: 1 })
    await preserveModerationRecords(mod.client as never, UID, 'Admin@Example.com')
    const aud = fakeAudit({ count: 1 })
    await pseudonymiseAdminAudit(aud.client as never, UID, '  admin@example.com ')
    expect(aud.seen[0].actor_email_hash).toBe(mod.seen[0].reported_user_hash)
  })

  it('writes nothing rather than an unsalted hash', async () => {
    vi.stubEnv('DELETION_HASH_SALT', '')
    const { client, seen } = fakeAudit({ count: 0 })
    const out = await pseudonymiseAdminAudit(client as never, UID, 'x@y.z')
    expect(out).toMatchObject({ detail: { skipped: 'no_salt' } })
    expect(seen).toHaveLength(0)
  })

  it('is inert before migration 0052 adds the column', async () => {
    vi.stubEnv('DELETION_HASH_SALT', 'pepper')
    const { client } = fakeAudit({ error: { message: 'column does not exist', code: '42703' } })
    const out = await pseudonymiseAdminAudit(client as never, UID, 'x@y.z')
    expect(out).toMatchObject({ ok: true, detail: { skipped: 'no_hash_column' } })
  })

  it('NEVER aborts a deletion, even on a real database error', async () => {
    // Unlike the moderation stamp this is housekeeping on our own records. A
    // user asking to be erased must not be stranded because an admin_audit
    // update failed.
    vi.stubEnv('DELETION_HASH_SALT', 'pepper')
    const { client } = fakeAudit({ error: { message: 'connection reset', code: '08006' } })
    const out = await pseudonymiseAdminAudit(client as never, UID, 'x@y.z')
    expect(out.ok).toBe(true)
    expect(out.detail).toHaveProperty('failed')
  })

  it('is a no-op with no email on file', async () => {
    vi.stubEnv('DELETION_HASH_SALT', 'pepper')
    const { client, seen } = fakeAudit({ count: 0 })
    const out = await pseudonymiseAdminAudit(client as never, UID, null)
    expect(out.ok).toBe(true)
    expect(seen).toHaveLength(0)
  })
})
