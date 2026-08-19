import { describe, it, expect, afterEach, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { encryptSecret, decryptSecret, envelopeVersion } from '@/lib/server/secrets'
import {
  reencryptExchangeSecrets,
  scanExchangeKeyVersions,
  canRetireVersion,
} from '@/lib/server/secrets-rotation'

/**
 * Tests for the re-encryption pass and the retirement guard
 * (audit item 10, finding 1 — P1).
 *
 * ── HOW THIS IS TESTED, GIVEN `exchange_accounts` HAS ZERO ROWS ─────────────
 *
 * Nobody has connected an exchange, so there is no production data to migrate
 * and the pass cannot be exercised against real rows. It is still needed the
 * moment the first row exists, so the migration path is proven here instead —
 * against a fake table that reproduces the two Postgres behaviours the pass
 * actually depends on:
 *
 *   * keyset pagination — `order by id, id > cursor, limit n`;
 *   * compare-and-swap — `update … where id = ? and api_key_enc = ?` matches
 *     zero rows when the ciphertext moved under us.
 *
 * The crypto is real throughout: real keys, real AES-GCM, real envelopes. Only
 * the storage is faked. `afterRead` lets a test mutate the table between the
 * read and the write, which is the concurrent-writer case that CAS exists for
 * and the one thing a live run could never be made to reproduce on demand.
 */

const OLD_KEY = Buffer.alloc(32, 7).toString('base64')
const NEW_KEY = Buffer.alloc(32, 3).toString('base64')
const BOTH = `v1:${OLD_KEY},v2:${NEW_KEY}`

type Row = {
  id: string
  api_key_enc: string | null
  api_secret_enc: string | null
  passphrase_enc: string | null
  status?: string
}

function fakeDb(rows: Row[], opts: { afterRead?: (state: Map<string, Row>) => void } = {}) {
  const state = new Map(rows.map((r) => [r.id, { ...r }]))
  const stats = { reads: 0, writes: 0 }

  const svc = {
    from(table: string) {
      if (table !== 'exchange_accounts') throw new Error(`unexpected table ${table}`)
      return {
        select() {
          const q: { gt: string | null; limit: number } = { gt: null, limit: Infinity }
          const b = {
            order: () => b,
            limit: (n: number) => { q.limit = n; return b },
            gt: (_col: string, v: string) => { q.gt = v; return b },
            then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
              stats.reads++
              const data = [...state.values()]
                .sort((a, b2) => (a.id < b2.id ? -1 : a.id > b2.id ? 1 : 0))
                .filter((r) => q.gt === null || r.id > q.gt)
                .slice(0, q.limit)
                .map((r) => ({ ...r }))
              opts.afterRead?.(state)
              return Promise.resolve({ data, error: null }).then(res, rej)
            },
          }
          return b
        },
        update(patch: Record<string, string>) {
          const filters: Array<[string, unknown]> = []
          const b = {
            eq: (col: string, val: unknown) => { filters.push([col, val]); return b },
            select: async () => {
              const hits = [...state.values()].filter((r) =>
                filters.every(([c, v]) => (r as unknown as Record<string, unknown>)[c] === v))
              for (const h of hits) { Object.assign(h, patch); stats.writes++ }
              return { data: hits.map((h) => ({ id: h.id })), error: null }
            },
          }
          return b
        },
      }
    },
  } as unknown as SupabaseClient

  return { svc, state, stats }
}

/** Seed rows encrypted under whatever key set is currently stubbed. */
async function seed(n: number, withPassphrase = false): Promise<Row[]> {
  const out: Row[] = []
  for (let i = 0; i < n; i++) {
    out.push({
      id: `a${i}`,
      api_key_enc: await encryptSecret(`key-${i}`),
      api_secret_enc: await encryptSecret(`secret-${i}`),
      passphrase_enc: withPassphrase ? await encryptSecret(`pass-${i}`) : null,
      status: 'active',
    })
  }
  return out
}

afterEach(() => { vi.unstubAllEnvs() })

describe('scanExchangeKeyVersions — the retirement guard', () => {
  it('detects outstanding ciphertext and refuses to retire the key that needs it', async () => {
    vi.stubEnv('EXCHANGE_KEY_SECRET', OLD_KEY)
    const rows = await seed(3)

    vi.stubEnv('EXCHANGE_KEY_SECRET', BOTH)
    const { svc } = fakeDb(rows)
    const scan = await scanExchangeKeyVersions(svc)

    expect(scan.rows).toBe(3)
    expect(scan.values).toBe(6)          // passphrase_enc is null on all three
    expect(scan.byVersion).toEqual({ v1: 6 })
    expect(scan.newest).toBe('v2')
    expect(scan.known).toEqual(['v1', 'v2'])
    expect(scan.retirable).toEqual([])   // v1 is still carrying every row
    expect(scan.missing).toEqual([])
    expect(scan.fullyMigrated).toBe(false)

    const verdict = canRetireVersion(scan, 'v1')
    expect(verdict.ok).toBe(false)
    expect(verdict.outstanding).toBe(6)
    expect(verdict.reason).toMatch(/re-encrypt first/)
  })

  it('clears v1 for retirement only once the pass has finished', async () => {
    vi.stubEnv('EXCHANGE_KEY_SECRET', OLD_KEY)
    const rows = await seed(3, true)

    vi.stubEnv('EXCHANGE_KEY_SECRET', BOTH)
    const { svc } = fakeDb(rows)
    await reencryptExchangeSecrets(svc)

    const scan = await scanExchangeKeyVersions(svc)
    expect(scan.byVersion).toEqual({ v2: 9 })  // 3 rows x 3 columns
    expect(scan.retirable).toEqual(['v1'])
    expect(scan.fullyMigrated).toBe(true)
    expect(canRetireVersion(scan, 'v1')).toEqual({ ok: true, outstanding: 0 })
  })

  it('never green-lights retiring the version new writes use', async () => {
    vi.stubEnv('EXCHANGE_KEY_SECRET', BOTH)
    const { svc } = fakeDb([])
    const scan = await scanExchangeKeyVersions(svc)
    const verdict = canRetireVersion(scan, 'v2')
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toMatch(/new writes/)
  })

  it('reports a version the data needs but the key set no longer holds', async () => {
    vi.stubEnv('EXCHANGE_KEY_SECRET', OLD_KEY)
    const rows = await seed(2)

    // The failure mode this whole task exists to prevent: v1 dropped early.
    vi.stubEnv('EXCHANGE_KEY_SECRET', `v2:${NEW_KEY}`)
    const { svc } = fakeDb(rows)
    const scan = await scanExchangeKeyVersions(svc)

    expect(scan.byVersion).toEqual({ v1: 4 })
    expect(scan.missing).toEqual(['v1'])
    expect(canRetireVersion(scan, 'v1').ok).toBe(false)
  })

  it('counts a corrupt value as malformed rather than as an old version', async () => {
    vi.stubEnv('EXCHANGE_KEY_SECRET', BOTH)
    const { svc } = fakeDb([
      { id: 'a1', api_key_enc: 'garbage', api_secret_enc: await encryptSecret('s'), passphrase_enc: null },
    ])
    const scan = await scanExchangeKeyVersions(svc)
    expect(scan.malformed).toBe(1)
    expect(scan.byVersion).toEqual({ v2: 1 })
  })

  it('is honest about an empty table — which is production today', async () => {
    vi.stubEnv('EXCHANGE_KEY_SECRET', OLD_KEY)
    const { svc } = fakeDb([])
    const scan = await scanExchangeKeyVersions(svc)
    expect(scan).toMatchObject({
      rows: 0, values: 0, byVersion: {}, missing: [], newest: 'v1', fullyMigrated: true,
    })
    // A bare key set has nothing to retire: v1 is also the newest.
    expect(scan.retirable).toEqual([])
  })
})

describe('reencryptExchangeSecrets', () => {
  it('moves every column onto the newest key and preserves the plaintext', async () => {
    vi.stubEnv('EXCHANGE_KEY_SECRET', OLD_KEY)
    const rows = await seed(3, true)

    vi.stubEnv('EXCHANGE_KEY_SECRET', BOTH)
    const { svc, state, stats } = fakeDb(rows)
    const report = await reencryptExchangeSecrets(svc)

    expect(report).toMatchObject({
      target: 'v2', rowsScanned: 3, rowsRewritten: 3,
      rowsAlreadyCurrent: 0, rowsRaced: 0, done: true, dryRun: false,
    })
    expect(report.failures).toEqual([])
    expect(stats.writes).toBe(3)

    for (let i = 0; i < 3; i++) {
      const row = state.get(`a${i}`)!
      expect(envelopeVersion(row.api_key_enc!)).toBe('v2')
      expect(envelopeVersion(row.api_secret_enc!)).toBe('v2')
      expect(envelopeVersion(row.passphrase_enc!)).toBe('v2')
      expect(await decryptSecret(row.api_key_enc!)).toBe(`key-${i}`)
      expect(await decryptSecret(row.api_secret_enc!)).toBe(`secret-${i}`)
      expect(await decryptSecret(row.passphrase_enc!)).toBe(`pass-${i}`)
    }
  })

  it('is idempotent — a second run rewrites nothing', async () => {
    vi.stubEnv('EXCHANGE_KEY_SECRET', OLD_KEY)
    const rows = await seed(3)

    vi.stubEnv('EXCHANGE_KEY_SECRET', BOTH)
    const { svc, state, stats } = fakeDb(rows)
    await reencryptExchangeSecrets(svc)
    const writesAfterFirst = stats.writes
    const snapshot = new Map([...state].map(([k, v]) => [k, { ...v }]))

    const second = await reencryptExchangeSecrets(svc)
    expect(second).toMatchObject({
      rowsScanned: 3, rowsRewritten: 0, rowsAlreadyCurrent: 3, rowsRaced: 0, done: true,
    })
    expect(stats.writes).toBe(writesAfterFirst)          // no further writes at all
    expect([...state]).toEqual([...snapshot])            // and nothing changed

    // Third run, for the operator who is not sure whether the second finished.
    const third = await reencryptExchangeSecrets(svc)
    expect(third.rowsAlreadyCurrent).toBe(3)
    expect(stats.writes).toBe(writesAfterFirst)
  })

  it('is a complete no-op on the bare-key environment deployed today', async () => {
    // No new key added: newest is v1, every row is already v1. This is what
    // happens if the code ships and nobody rotates anything.
    vi.stubEnv('EXCHANGE_KEY_SECRET', OLD_KEY)
    const rows = await seed(2)
    const { svc, stats } = fakeDb(rows)

    const report = await reencryptExchangeSecrets(svc)
    expect(report).toMatchObject({ target: 'v1', rowsRewritten: 0, rowsAlreadyCurrent: 2 })
    expect(stats.writes).toBe(0)
  })

  it('leaves a row alone when it changed under us, and counts the race', async () => {
    vi.stubEnv('EXCHANGE_KEY_SECRET', OLD_KEY)
    const rows = await seed(2)
    const reconnected = await encryptSecret('user-reconnected')

    vi.stubEnv('EXCHANGE_KEY_SECRET', BOTH)
    let fired = false
    const { svc, state } = fakeDb(rows, {
      afterRead: (s) => {
        // Simulate the user reconnecting their exchange between our read and
        // our write. The CAS filter must miss, and their new value must stand.
        if (fired) return
        fired = true
        s.get('a0')!.api_key_enc = reconnected
      },
    })

    const report = await reencryptExchangeSecrets(svc)
    expect(report.rowsRaced).toBe(1)
    expect(report.rowsRewritten).toBe(1)
    expect(state.get('a0')!.api_key_enc).toBe(reconnected)   // not clobbered
    expect(await decryptSecret(state.get('a0')!.api_key_enc!)).toBe('user-reconnected')
    expect(envelopeVersion(state.get('a1')!.api_key_enc!)).toBe('v2')

    // And the raced row is picked up by simply running the pass again.
    const again = await reencryptExchangeSecrets(svc)
    expect(again.rowsRewritten).toBe(1)
    expect(envelopeVersion(state.get('a0')!.api_key_enc!)).toBe('v2')
    expect(await decryptSecret(state.get('a0')!.api_key_enc!)).toBe('user-reconnected')
  })

  it('dryRun proves every row is readable and writes nothing', async () => {
    vi.stubEnv('EXCHANGE_KEY_SECRET', OLD_KEY)
    const rows = await seed(3)

    vi.stubEnv('EXCHANGE_KEY_SECRET', BOTH)
    const { svc, state, stats } = fakeDb(rows)
    const report = await reencryptExchangeSecrets(svc, { dryRun: true })

    expect(report).toMatchObject({ dryRun: true, rowsScanned: 3, rowsRewritten: 3, done: true })
    expect(report.failures).toEqual([])
    expect(stats.writes).toBe(0)
    expect(envelopeVersion(state.get('a0')!.api_key_enc!)).toBe('v1')  // untouched
  })

  it('dryRun catches a missing key BEFORE anything is written', async () => {
    vi.stubEnv('EXCHANGE_KEY_SECRET', OLD_KEY)
    const rows = await seed(2)

    vi.stubEnv('EXCHANGE_KEY_SECRET', `v2:${NEW_KEY}`)   // v1 dropped too early
    const { svc, stats } = fakeDb(rows)
    const report = await reencryptExchangeSecrets(svc, { dryRun: true })

    expect(stats.writes).toBe(0)
    expect(report.rowsRewritten).toBe(0)
    expect(report.failures).toHaveLength(2)
    expect(report.failures[0]).toEqual({
      id: 'a0', column: 'api_key_enc', version: 'v1', reason: 'decrypt',
    })
  })

  it('records a failure without aborting the rest of the pass', async () => {
    vi.stubEnv('EXCHANGE_KEY_SECRET', OLD_KEY)
    const good = await seed(2)

    vi.stubEnv('EXCHANGE_KEY_SECRET', BOTH)
    const { svc, state } = fakeDb([
      { id: 'a5', api_key_enc: 'corrupt', api_secret_enc: 'corrupt', passphrase_enc: null },
      ...good,
    ])
    const report = await reencryptExchangeSecrets(svc)

    expect(report.failures).toHaveLength(1)
    expect(report.failures[0].reason).toBe('decrypt')
    expect(report.rowsRewritten).toBe(2)                    // the other two still moved
    expect(state.get('a5')!.api_key_enc).toBe('corrupt')    // untouched, not half-written
  })

  it('never puts plaintext or ciphertext in a failure record', async () => {
    vi.stubEnv('EXCHANGE_KEY_SECRET', OLD_KEY)
    const rows = await seed(1)
    const ciphertext = rows[0].api_key_enc!

    vi.stubEnv('EXCHANGE_KEY_SECRET', `v2:${NEW_KEY}`)
    const { svc } = fakeDb(rows)
    const report = await reencryptExchangeSecrets(svc)

    const serialised = JSON.stringify(report)
    expect(serialised).not.toContain(ciphertext)
    expect(serialised).not.toContain(ciphertext.split('.')[2])
    expect(serialised).not.toContain('key-0')
  })

  it('pages and resumes from the returned cursor', async () => {
    vi.stubEnv('EXCHANGE_KEY_SECRET', OLD_KEY)
    const rows = await seed(3)

    vi.stubEnv('EXCHANGE_KEY_SECRET', BOTH)
    const { svc, state } = fakeDb(rows)

    const first = await reencryptExchangeSecrets(svc, { batchSize: 1, maxRows: 1 })
    expect(first).toMatchObject({ rowsScanned: 1, rowsRewritten: 1, done: false, cursor: 'a0' })
    expect(envelopeVersion(state.get('a1')!.api_key_enc!)).toBe('v1')   // untouched so far

    const second = await reencryptExchangeSecrets(svc, { batchSize: 1, maxRows: 1, cursor: first.cursor })
    expect(second).toMatchObject({ rowsScanned: 1, done: false, cursor: 'a1' })

    // Resuming from the start instead is also safe — the finished rows are skipped.
    const rest = await reencryptExchangeSecrets(svc)
    expect(rest).toMatchObject({ rowsScanned: 3, rowsRewritten: 1, rowsAlreadyCurrent: 2, done: true })
    expect((await scanExchangeKeyVersions(svc)).fullyMigrated).toBe(true)
  })

  it('skips null passphrase columns rather than treating them as ciphertext', async () => {
    vi.stubEnv('EXCHANGE_KEY_SECRET', OLD_KEY)
    const rows = await seed(1)

    vi.stubEnv('EXCHANGE_KEY_SECRET', BOTH)
    const { svc, state } = fakeDb(rows)
    const report = await reencryptExchangeSecrets(svc)

    expect(report.failures).toEqual([])
    expect(state.get('a0')!.passphrase_enc).toBeNull()
  })

  it('touches only the encrypted columns, so a concurrent sync update survives', async () => {
    vi.stubEnv('EXCHANGE_KEY_SECRET', OLD_KEY)
    const rows = await seed(1)

    vi.stubEnv('EXCHANGE_KEY_SECRET', BOTH)
    const { svc, state } = fakeDb(rows, {
      afterRead: (s) => { s.get('a0')!.status = 'error' },   // crypto-sync writing status
    })
    await reencryptExchangeSecrets(svc)

    expect(state.get('a0')!.status).toBe('error')            // not reverted
    expect(envelopeVersion(state.get('a0')!.api_key_enc!)).toBe('v2')
  })
})
