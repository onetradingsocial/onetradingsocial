import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptSecret, encryptSecret, envelopeVersion, exchangeKeyVersions } from '@/lib/server/secrets'

/**
 * Re-encryption and retirement tooling for `EXCHANGE_KEY_SECRET`
 * (audit item 10, finding 1 — P1).
 *
 * `secrets.ts` makes rotation *possible*: two keys can be held at once and each
 * envelope names the key that wrote it. This file is what makes rotation
 * *finishable* — it moves stored ciphertext onto the new key, and it proves the
 * old key is no longer needed before anyone deletes it.
 *
 * ── THE ORDER, AND WHY EACH STEP IS WHERE IT IS ─────────────────────────────
 *
 *   1. add the new key         EXCHANGE_KEY_SECRET=v1:<old>,v2:<new>
 *   2. deploy                  new writes land as v2; v1 rows still decrypt
 *   3. re-encrypt              `reencryptExchangeSecrets`, repeat until done
 *   4. prove v1 is unreferenced `scanExchangeKeyVersions` → byVersion.v1 === 0
 *   5. drop the old key        EXCHANGE_KEY_SECRET=v2:<new>  (or bare <new>)
 *
 * Step 4 is the whole point. Step 5 without it is the data loss this change
 * exists to prevent, and it is silent — nothing fails until the next sync, by
 * which time the key is gone.
 *
 * ── SAFE TO RUN WHILE THE APP IS LIVE ───────────────────────────────────────
 *
 * Three properties, each load-bearing:
 *
 * **A concurrent reader always sees a decryptable row.** Every column of a row
 * is rewritten in one UPDATE, so a row is never half-migrated; and during the
 * overlap the process holds BOTH keys, so `crypto-sync` decrypts the old form
 * and the new form equally. This is why the pass must run between steps 2 and
 * 5 and nowhere else.
 *
 * **A concurrent writer wins.** The write is a compare-and-swap: the UPDATE
 * filters on the exact ciphertext that was read. If anything changed the row in
 * between — a reconnect, a support fix, a second copy of this pass — the update
 * matches zero rows and is counted as `raced` rather than clobbering it. Two
 * operators running this at once cannot corrupt a row; the loser just records a
 * race.
 *
 * **Idempotent and resumable.** A row already on the newest version is skipped
 * without a write, so a second full run rewrites nothing. Batches are keyset
 * paginated by `id`, so an interrupted run resumes from the returned cursor —
 * and even a run restarted from the beginning only re-reads what it already
 * finished.
 *
 * ── WHAT IS NEVER IN THE OUTPUT ─────────────────────────────────────────────
 *
 * Row ids, column names, version labels and counts. Never plaintext, never
 * ciphertext, and never a passed-through error string — failures carry a fixed
 * vocabulary (`decrypt` / `encrypt` / `write`) so a report can be pasted into a
 * ticket without a second thought. Consistent with `lib/redact.ts` and
 * `lib/server/log.ts`, which exist for exactly this reason.
 */

/** Every ciphertext-bearing column on `exchange_accounts` (migration 0037). */
export const ENCRYPTED_COLUMNS = ['api_key_enc', 'api_secret_enc', 'passphrase_enc'] as const
export type EncryptedColumn = (typeof ENCRYPTED_COLUMNS)[number]

const SELECT = ['id', ...ENCRYPTED_COLUMNS].join(', ')
const DEFAULT_BATCH = 200

type Row = { id: string } & Partial<Record<EncryptedColumn, string | null>>

const ciphertexts = (row: Row): Array<[EncryptedColumn, string]> =>
  ENCRYPTED_COLUMNS.flatMap((col) => {
    const v = row[col]
    return typeof v === 'string' && v.length > 0 ? [[col, v] as [EncryptedColumn, string]] : []
  })

async function readBatch(
  svc: SupabaseClient,
  cursor: string | null,
  batchSize: number,
): Promise<Row[]> {
  let q = svc
    .from('exchange_accounts')
    .select(SELECT)
    .order('id', { ascending: true })
    .limit(batchSize)
  if (cursor) q = q.gt('id', cursor)
  const { data, error } = await q
  // The message is dropped on purpose: a PostgREST error can echo row values
  // (lib/redact.ts, describeError). The caller gets the fact, not the payload.
  if (error) throw new Error('exchange key rotation: read failed')
  return (data ?? []) as unknown as Row[]
}

export type VersionScan = {
  /** Rows examined. */
  rows: number
  /** Individual ciphertext values examined (a row carries two or three). */
  values: number
  /** Ciphertext count per version label found in the data. */
  byVersion: Record<string, number>
  /** Values whose prefix is not a version label at all — corrupt, not old. */
  malformed: number
  /** The version `encryptSecret` is currently writing. */
  newest: string
  /** Version labels this process holds a key for. */
  known: string[]
  /**
   * Held keys with zero outstanding ciphertext, excluding `newest`. These and
   * only these are safe to remove from `EXCHANGE_KEY_SECRET`.
   */
  retirable: string[]
  /**
   * Versions the DATA references that this process holds NO key for. Must be
   * empty. A non-empty list means those rows are already unrecoverable with the
   * deployed key set — stop, restore the missing key, and do not re-encrypt.
   */
  missing: string[]
  /** True when nothing is left to migrate: every value is already on `newest`. */
  fullyMigrated: boolean
}

/**
 * The retirement guard. Walks every stored ciphertext and reports which key
 * version each one needs.
 *
 * Read-only — it never decrypts and never writes, so it is safe to run at any
 * time, including against a key set that is missing a key (which is the one
 * situation where you most need an answer).
 */
export async function scanExchangeKeyVersions(
  svc: SupabaseClient,
  opts: { batchSize?: number } = {},
): Promise<VersionScan> {
  const batchSize = opts.batchSize ?? DEFAULT_BATCH
  const { newest, versions } = await exchangeKeyVersions()

  const byVersion: Record<string, number> = {}
  let rows = 0
  let values = 0
  let malformed = 0
  let cursor: string | null = null

  for (;;) {
    const batch: Row[] = await readBatch(svc, cursor, batchSize)
    if (batch.length === 0) break
    for (const row of batch) {
      rows++
      for (const [, enc] of ciphertexts(row)) {
        values++
        const v = envelopeVersion(enc)
        if (!v) { malformed++; continue }
        byVersion[v] = (byVersion[v] ?? 0) + 1
      }
    }
    cursor = batch[batch.length - 1].id
    if (batch.length < batchSize) break
  }

  const found = Object.keys(byVersion)
  return {
    rows,
    values,
    byVersion,
    malformed,
    newest,
    known: versions,
    retirable: versions.filter((v) => v !== newest && !byVersion[v]),
    missing: found.filter((v) => !versions.includes(v)),
    fullyMigrated: found.every((v) => v === newest),
  }
}

/**
 * Is it safe to delete `version` from `EXCHANGE_KEY_SECRET`? Never guesses:
 * the answer comes from the scan, and anything other than a clean yes is a no.
 */
export function canRetireVersion(
  scan: VersionScan,
  version: string,
): { ok: boolean; outstanding: number; reason?: string } {
  const outstanding = scan.byVersion[version] ?? 0
  if (version === scan.newest) {
    return { ok: false, outstanding, reason: 'that is the version new writes use' }
  }
  if (!scan.known.includes(version)) {
    return { ok: false, outstanding, reason: 'the key set does not hold that version' }
  }
  if (outstanding > 0) {
    return { ok: false, outstanding, reason: 'stored ciphertext still needs it — re-encrypt first' }
  }
  if (scan.missing.length > 0) {
    return { ok: false, outstanding, reason: 'data references a key version this process does not hold' }
  }
  return { ok: true, outstanding: 0 }
}

export type ReencryptFailure = {
  id: string
  column: EncryptedColumn | null
  version: string | null
  /** Fixed vocabulary. Never a passed-through error message. */
  reason: 'decrypt' | 'encrypt' | 'write'
}

export type ReencryptReport = {
  /** Version everything is being moved onto. */
  target: string
  rowsScanned: number
  /** Rows rewritten (or, under `dryRun`, that would have been). */
  rowsRewritten: number
  /** Rows already entirely on `target`. A second run should report only these. */
  rowsAlreadyCurrent: number
  /** Rows whose ciphertext changed under us mid-pass. Re-run to pick them up. */
  rowsRaced: number
  failures: ReencryptFailure[]
  /** False when `maxRows` cut the pass short — resume with `cursor`. */
  done: boolean
  /** Last id processed. Pass back as `cursor` to continue. */
  cursor: string | null
  dryRun: boolean
}

/**
 * Move every stored ciphertext onto the newest key. Decrypt with whichever key
 * the envelope names, re-encrypt with the newest, write back under a
 * compare-and-swap.
 *
 * `dryRun` does the full decrypt/re-encrypt — so it genuinely proves every
 * value is readable with the deployed key set — and then skips only the write.
 * That is the rehearsal worth running first, because the failure it catches
 * (a key you no longer hold) is the one that cannot be fixed afterwards.
 *
 * A row that fails does not abort the pass: it is recorded and the pass moves
 * on, because one corrupt row must not block every other user's migration.
 */
export async function reencryptExchangeSecrets(
  svc: SupabaseClient,
  opts: {
    batchSize?: number
    /** Stop after roughly this many rows; use with `cursor` to page a big table. */
    maxRows?: number
    cursor?: string | null
    dryRun?: boolean
  } = {},
): Promise<ReencryptReport> {
  const batchSize = opts.batchSize ?? DEFAULT_BATCH
  const dryRun = opts.dryRun ?? false
  const { newest } = await exchangeKeyVersions()

  const report: ReencryptReport = {
    target: newest,
    rowsScanned: 0,
    rowsRewritten: 0,
    rowsAlreadyCurrent: 0,
    rowsRaced: 0,
    failures: [],
    done: false,
    cursor: opts.cursor ?? null,
    dryRun,
  }

  for (;;) {
    const batch: Row[] = await readBatch(svc, report.cursor, batchSize)
    if (batch.length === 0) { report.done = true; break }

    for (const row of batch) {
      report.rowsScanned++
      report.cursor = row.id

      const updates: Partial<Record<EncryptedColumn, string>> = {}
      let failed = false

      for (const [column, enc] of ciphertexts(row)) {
        const version = envelopeVersion(enc)
        if (version === newest) continue // already current
        let plain: string
        try {
          plain = await decryptSecret(enc)
        } catch {
          report.failures.push({ id: row.id, column, version, reason: 'decrypt' })
          failed = true
          break
        }
        try {
          updates[column] = await encryptSecret(plain)
        } catch {
          report.failures.push({ id: row.id, column, version, reason: 'encrypt' })
          failed = true
          break
        }
      }

      // All-or-nothing per row. A row whose second column failed must not be
      // written with only its first column moved: partial rows are exactly what
      // makes a half-finished rotation hard to reason about later.
      if (failed) continue
      if (Object.keys(updates).length === 0) { report.rowsAlreadyCurrent++; continue }
      if (dryRun) { report.rowsRewritten++; continue }

      // Compare-and-swap: the filter names the ciphertext we read, so a row that
      // moved under us is left alone rather than overwritten.
      let q = svc.from('exchange_accounts').update(updates).eq('id', row.id)
      for (const column of Object.keys(updates) as EncryptedColumn[]) {
        q = q.eq(column, row[column] as string)
      }
      const { data, error } = await q.select('id')
      if (error) {
        report.failures.push({ id: row.id, column: null, version: null, reason: 'write' })
        continue
      }
      if (!data || data.length === 0) { report.rowsRaced++; continue }
      report.rowsRewritten++
    }

    if (batch.length < batchSize) { report.done = true; break }
    if (opts.maxRows != null && report.rowsScanned >= opts.maxRows) break
  }

  return report
}
