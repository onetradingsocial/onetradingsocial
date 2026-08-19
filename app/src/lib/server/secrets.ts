import 'server-only'
import { webcrypto } from 'node:crypto'

/**
 * AES-256-GCM envelope for user secrets (exchange API keys).
 *
 * The master key lives only in the environment — never in Postgres — so a
 * database dump on its own is inert. Fails closed: there is no plaintext
 * fallback path, and neither plaintext nor ciphertext is ever put in an error
 * message or a log line.
 *
 * ── WHY THIS FILE CHANGED (audit item 10, finding 1 — P1) ───────────────────
 *
 * The original read exactly one value from `EXCHANGE_KEY_SECRET` and compared
 * every envelope's prefix against one hardcoded `VERSION` constant. Two
 * consequences, both bad:
 *
 *   1. replacing the env value made every stored ciphertext fail
 *      authentication, permanently and unrecoverably;
 *   2. `docs/secret-rotation.md` told an operator to rotate on exposure — an
 *      instruction that would have destroyed credentials nobody could then
 *      decrypt in order to warn their owners.
 *
 * The envelope already carried a version prefix that nothing read. The original
 * design anticipated this; it was simply never implemented. It is now.
 *
 * ── THE KEY-SET FORMAT ──────────────────────────────────────────────────────
 *
 *   EXCHANGE_KEY_SECRET=<base64>                  legacy, bare — means v1
 *   EXCHANGE_KEY_SECRET=v1:<base64>,v2:<base64>   a key set
 *
 * A bare value keeps working EXACTLY as before and is read as `v1`, because
 * that is what every envelope written to date is labelled. The deployed
 * environment holds a bare key; this change must be — and is — a no-op there.
 *
 * `,` and `:` are safe delimiters: standard base64 uses only `A–Z a–z 0–9 + / =`,
 * so neither can appear inside key material. `.` stays out of version labels so
 * the three-part envelope split is unambiguous.
 *
 * ── WHICH KEY IS USED, AND WHEN ─────────────────────────────────────────────
 *
 * ENCRYPT with the highest-numbered version in the set, and stamp that label
 * into the envelope. "Highest number", not "last one listed" — an operator who
 * prepends rather than appends must not silently change which key protects new
 * data.
 *
 * DECRYPT by looking the envelope's OWN prefix up in the set. A version the set
 * does not hold throws `malformed envelope` — the same non-leaking error as any
 * other unusable input. It deliberately does not say "unknown key version":
 * one error surface, no oracle, and the operator-facing diagnostic for a
 * half-finished rotation is `scanExchangeKeyVersions` in `secrets-rotation.ts`,
 * which reports outstanding versions properly instead of leaving them to be
 * inferred from a thrown string.
 *
 * ── THE RULE THAT MATTERS ───────────────────────────────────────────────────
 *
 * Never remove a key from the set while any stored ciphertext still names it.
 * `secrets-rotation.ts` exists to prove that before you do. Losing a key while
 * rows still need it is the exact failure this whole change was written to
 * prevent, and no amount of care at the call sites can undo it afterwards.
 */

const IV_BYTES = 12

/** The label a bare (unlabelled) key is understood to mean. */
const LEGACY_VERSION = 'v1'

/** Version labels are `v` + a positive integer. No `.`, no leading zeros. */
const VERSION_RE = /^v[1-9][0-9]*$/

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'))

// Node's webcrypto CryptoKey and the DOM lib's CryptoKey are structurally
// different types under this TS config; derive ours from the actual call.
type MasterKey = Awaited<ReturnType<typeof webcrypto.subtle.importKey>>

type KeySet = {
  /** Version label used for every new encryption. */
  newest: string
  /** Every label held, ascending by version number. */
  versions: string[]
  keys: Map<string, MasterKey>
}

/**
 * Parse `EXCHANGE_KEY_SECRET` into `[version, base64]` pairs.
 *
 * Ambiguity is rejected rather than guessed at. A duplicate version label, a
 * mix of bare and labelled entries, or a label that is not `vN` all throw at
 * parse time — before any ciphertext is written under a key the operator did
 * not mean to select.
 */
function parseEntries(raw: string): Array<[string, string]> {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error('EXCHANGE_KEY_SECRET is not set')

  // Base64 contains neither `,` nor `:`, so their absence proves the bare form.
  if (!trimmed.includes(',') && !trimmed.includes(':')) {
    return [[LEGACY_VERSION, trimmed]]
  }

  const out: Array<[string, string]> = []
  const seen = new Set<string>()
  for (const chunk of trimmed.split(',')) {
    const entry = chunk.trim()
    if (!entry) continue // tolerate a trailing comma or a wrapped line
    const sep = entry.indexOf(':')
    if (sep < 1) {
      throw new Error('EXCHANGE_KEY_SECRET: mixed bare and labelled keys; use "v1:<base64>,v2:<base64>"')
    }
    const version = entry.slice(0, sep).trim()
    const material = entry.slice(sep + 1).trim()
    if (!VERSION_RE.test(version)) {
      throw new Error('EXCHANGE_KEY_SECRET: version labels must look like v1, v2, …')
    }
    if (!material) throw new Error(`EXCHANGE_KEY_SECRET: no key material for ${version}`)
    if (seen.has(version)) throw new Error(`EXCHANGE_KEY_SECRET: duplicate key version ${version}`)
    seen.add(version)
    out.push([version, material])
  }
  if (out.length === 0) throw new Error('EXCHANGE_KEY_SECRET is not set')
  return out
}

async function buildKeySet(raw: string): Promise<KeySet> {
  const entries = parseEntries(raw)
  const keys = new Map<string, MasterKey>()
  for (const [version, material] of entries) {
    const bytes = unb64(material)
    if (bytes.length !== 32) {
      throw new Error(`EXCHANGE_KEY_SECRET must decode to 32 bytes (${version} does not)`)
    }
    keys.set(
      version,
      await webcrypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']),
    )
  }
  const versions = [...keys.keys()].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
  return { newest: versions[versions.length - 1], versions, keys }
}

/**
 * Cached against the raw env string, so the re-encryption pass does not re-import
 * the same keys once per row, and so a changed environment (or a test stubbing
 * one) is always picked up. Failures are never cached — a bad value must report
 * itself on every call, not once.
 */
let cache: { raw: string; set: Promise<KeySet> } | null = null

async function keySet(): Promise<KeySet> {
  const raw = process.env.EXCHANGE_KEY_SECRET ?? ''
  if (!cache || cache.raw !== raw) {
    const built = buildKeySet(raw)
    cache = { raw, set: built }
    built.catch(() => { if (cache?.set === built) cache = null })
  }
  return cache.set
}

/**
 * The version labels this process holds. `newest` is what `encryptSecret`
 * writes. Exported for the rotation tooling and its runbook output — labels
 * only, never key material.
 */
export async function exchangeKeyVersions(): Promise<{ newest: string; versions: string[] }> {
  const { newest, versions } = await keySet()
  return { newest, versions }
}

/**
 * The version prefix an envelope names, or `null` if it is not an envelope.
 * Pure and total: it never decrypts, never touches the key set, and is safe to
 * run over ciphertext the current key set cannot open — which is precisely what
 * the retirement guard needs.
 */
export function envelopeVersion(enc: string): string | null {
  const parts = enc.split('.')
  if (parts.length !== 3 || !VERSION_RE.test(parts[0])) return null
  return parts[0]
}

export async function encryptSecret(plain: string): Promise<string> {
  if (!plain) throw new Error('encryptSecret: empty input')
  const set = await keySet()
  const key = set.keys.get(set.newest)
  if (!key) throw new Error('encryptSecret: no key available')
  const iv = webcrypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ct = new Uint8Array(
    await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)),
  )
  return `${set.newest}.${b64(iv)}.${b64(ct)}`
}

export async function decryptSecret(enc: string): Promise<string> {
  const version = envelopeVersion(enc)
  if (!version) throw new Error('decryptSecret: malformed envelope')
  const parts = enc.split('.')
  const set = await keySet()
  const key = set.keys.get(version)
  // A version we do not hold fails closed with the same error as any other
  // unusable envelope. See the header: one error surface, no oracle.
  if (!key) throw new Error('decryptSecret: malformed envelope')
  let plain: ArrayBuffer
  try {
    plain = await webcrypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(parts[1]) }, key, unb64(parts[2]),
    )
  } catch {
    throw new Error('decryptSecret: authentication failed')
  }
  return new TextDecoder().decode(plain)
}
