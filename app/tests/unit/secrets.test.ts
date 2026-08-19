import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import {
  encryptSecret, decryptSecret, envelopeVersion, exchangeKeyVersions,
} from '@/lib/server/secrets'

// 32 zero bytes, base64. Test-only key.
const KEY = Buffer.alloc(32, 7).toString('base64')
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64')
const NEW_KEY = Buffer.alloc(32, 3).toString('base64')

/**
 * The ORIGINAL single-key algorithm, re-implemented here against raw webcrypto
 * so it cannot drift with the module under test. Anything this produces is
 * byte-for-byte what production has been writing to `api_key_enc` since day
 * one, which is what makes the backwards-compatibility assertions below mean
 * something rather than merely round-tripping the new code against itself.
 */
async function legacyEncrypt(keyB64: string, plain: string): Promise<string> {
  const key = await webcrypto.subtle.importKey(
    'raw', new Uint8Array(Buffer.from(keyB64, 'base64')), { name: 'AES-GCM' }, false, ['encrypt'],
  )
  const iv = webcrypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(
    await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)),
  )
  return `v1.${Buffer.from(iv).toString('base64')}.${Buffer.from(ct).toString('base64')}`
}

describe('secrets', () => {
  beforeEach(() => { vi.stubEnv('EXCHANGE_KEY_SECRET', KEY) })
  afterEach(() => { vi.unstubAllEnvs() })

  it('roundtrips a secret', async () => {
    const enc = await encryptSecret('binance-api-key-123')
    expect(await decryptSecret(enc)).toBe('binance-api-key-123')
  })

  it('emits the v1.<iv>.<ct> format and never the plaintext', async () => {
    const enc = await encryptSecret('binance-api-key-123')
    const parts = enc.split('.')
    expect(parts).toHaveLength(3)
    expect(parts[0]).toBe('v1')
    expect(enc).not.toContain('binance-api-key-123')
  })

  it('uses a fresh IV per call', async () => {
    const a = await encryptSecret('same')
    const b = await encryptSecret('same')
    expect(a).not.toBe(b)
    expect(await decryptSecret(b)).toBe('same')
  })

  it('rejects tampered ciphertext', async () => {
    const enc = await encryptSecret('tamper-me')
    const [v, iv, ct] = enc.split('.')
    const flipped = Buffer.from(ct, 'base64')
    flipped[0] ^= 0xff
    await expect(decryptSecret(`${v}.${iv}.${flipped.toString('base64')}`))
      .rejects.toThrow('authentication failed')
  })

  it('rejects a malformed envelope', async () => {
    await expect(decryptSecret('not-an-envelope')).rejects.toThrow('malformed')
    await expect(decryptSecret('v2.aaaa.bbbb')).rejects.toThrow('malformed')
  })

  it('rejects the wrong master key', async () => {
    const enc = await encryptSecret('wrong-key-test')
    vi.stubEnv('EXCHANGE_KEY_SECRET', OTHER_KEY)
    await expect(decryptSecret(enc)).rejects.toThrow('authentication failed')
  })

  it('throws when the env var is missing', async () => {
    vi.stubEnv('EXCHANGE_KEY_SECRET', '')
    await expect(encryptSecret('x')).rejects.toThrow('EXCHANGE_KEY_SECRET')
  })

  it('throws when the env var is not 32 bytes', async () => {
    vi.stubEnv('EXCHANGE_KEY_SECRET', Buffer.alloc(16, 1).toString('base64'))
    await expect(encryptSecret('x')).rejects.toThrow('32 bytes')
  })
})

/**
 * Key rotation (audit item 10, finding 1 — P1).
 *
 * The property that governs every test here: the DEPLOYED environment holds a
 * BARE key and must keep working untouched. Everything else is additive.
 */
describe('secrets — key set', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  describe('backwards compatibility (this is the deployed configuration)', () => {
    it('reads a bare key as v1 and decrypts ciphertext the OLD code wrote', async () => {
      vi.stubEnv('EXCHANGE_KEY_SECRET', KEY)
      const legacy = await legacyEncrypt(KEY, 'binance-api-key-123')
      expect(await decryptSecret(legacy)).toBe('binance-api-key-123')
    })

    it('still writes v1 envelopes under a bare key — no change on deploy', async () => {
      vi.stubEnv('EXCHANGE_KEY_SECRET', KEY)
      expect(await exchangeKeyVersions()).toEqual({ newest: 'v1', versions: ['v1'] })
      const enc = await encryptSecret('unchanged')
      expect(enc.startsWith('v1.')).toBe(true)
    })

    it('a bare key and an explicit v1: label are the same key set', async () => {
      vi.stubEnv('EXCHANGE_KEY_SECRET', KEY)
      const bare = await encryptSecret('same-key-both-ways')
      vi.stubEnv('EXCHANGE_KEY_SECRET', `v1:${KEY}`)
      expect(await decryptSecret(bare)).toBe('same-key-both-ways')
    })
  })

  describe('a two-key set', () => {
    it('decrypts both the old and the new version', async () => {
      vi.stubEnv('EXCHANGE_KEY_SECRET', KEY)
      const old = await encryptSecret('old-secret')

      vi.stubEnv('EXCHANGE_KEY_SECRET', `v1:${KEY},v2:${NEW_KEY}`)
      const fresh = await encryptSecret('new-secret')

      expect(await decryptSecret(old)).toBe('old-secret')     // written under v1
      expect(await decryptSecret(fresh)).toBe('new-secret')   // written under v2
    })

    it('encrypts with the newest version', async () => {
      vi.stubEnv('EXCHANGE_KEY_SECRET', `v1:${KEY},v2:${NEW_KEY}`)
      const enc = await encryptSecret('x')
      expect(envelopeVersion(enc)).toBe('v2')
      expect(await exchangeKeyVersions()).toEqual({ newest: 'v2', versions: ['v1', 'v2'] })
    })

    it('picks the highest version NUMBER, not the last one listed', async () => {
      // An operator who prepends rather than appends must not silently change
      // which key protects new data.
      vi.stubEnv('EXCHANGE_KEY_SECRET', `v2:${NEW_KEY},v1:${KEY}`)
      expect(envelopeVersion(await encryptSecret('x'))).toBe('v2')

      // And double digits sort numerically, not lexically.
      vi.stubEnv('EXCHANGE_KEY_SECRET', `v9:${KEY},v10:${NEW_KEY}`)
      expect(envelopeVersion(await encryptSecret('x'))).toBe('v10')
    })

    it('tolerates whitespace and a trailing comma', async () => {
      vi.stubEnv('EXCHANGE_KEY_SECRET', ` v1: ${KEY} , v2: ${NEW_KEY} , `)
      expect(await exchangeKeyVersions()).toEqual({ newest: 'v2', versions: ['v1', 'v2'] })
    })

    it('validates the length of EVERY key in the set, not just the first', async () => {
      vi.stubEnv('EXCHANGE_KEY_SECRET', `v1:${KEY},v2:${Buffer.alloc(16, 1).toString('base64')}`)
      await expect(encryptSecret('x')).rejects.toThrow('32 bytes')
    })
  })

  describe('fails closed', () => {
    it('rejects a version the key set does not hold', async () => {
      vi.stubEnv('EXCHANGE_KEY_SECRET', `v1:${KEY},v2:${NEW_KEY}`)
      const enc = await encryptSecret('retired-key-test')

      // v2 dropped from the env while ciphertext still names it — the exact
      // mistake the retirement guard exists to prevent. It must NOT decrypt,
      // and must not hint at why beyond "unusable envelope".
      vi.stubEnv('EXCHANGE_KEY_SECRET', `v1:${KEY}`)
      await expect(decryptSecret(enc)).rejects.toThrow('malformed envelope')
    })

    it('never leaks plaintext or ciphertext through an error', async () => {
      vi.stubEnv('EXCHANGE_KEY_SECRET', `v1:${KEY}`)
      const enc = `v7.${Buffer.alloc(12).toString('base64')}.${Buffer.alloc(20).toString('base64')}`
      const err = await decryptSecret(enc).catch((e: Error) => e)
      expect((err as Error).message).toBe('decryptSecret: malformed envelope')
      expect((err as Error).message).not.toContain(enc.split('.')[2])
    })

    it('rejects a duplicate version label rather than picking one', async () => {
      vi.stubEnv('EXCHANGE_KEY_SECRET', `v1:${KEY},v1:${NEW_KEY}`)
      await expect(encryptSecret('x')).rejects.toThrow('duplicate key version v1')
    })

    it('rejects a label that is not vN', async () => {
      vi.stubEnv('EXCHANGE_KEY_SECRET', `current:${KEY},v2:${NEW_KEY}`)
      await expect(encryptSecret('x')).rejects.toThrow('version labels')
    })

    it('rejects bare and labelled keys mixed together', async () => {
      vi.stubEnv('EXCHANGE_KEY_SECRET', `${KEY},v2:${NEW_KEY}`)
      await expect(encryptSecret('x')).rejects.toThrow('mixed bare and labelled')
    })

    it('does not cache a bad key set — every call re-reports', async () => {
      vi.stubEnv('EXCHANGE_KEY_SECRET', `v1:${KEY},v1:${NEW_KEY}`)
      await expect(encryptSecret('x')).rejects.toThrow('duplicate')
      await expect(encryptSecret('x')).rejects.toThrow('duplicate')
      vi.stubEnv('EXCHANGE_KEY_SECRET', KEY)
      expect(envelopeVersion(await encryptSecret('x'))).toBe('v1')
    })

    it('still rejects the wrong key material with a two-key set', async () => {
      vi.stubEnv('EXCHANGE_KEY_SECRET', `v1:${KEY}`)
      const enc = await encryptSecret('x')
      vi.stubEnv('EXCHANGE_KEY_SECRET', `v1:${OTHER_KEY},v2:${NEW_KEY}`)
      await expect(decryptSecret(enc)).rejects.toThrow('authentication failed')
    })
  })

  describe('envelopeVersion', () => {
    it('reads the prefix without touching the key set', () => {
      expect(envelopeVersion('v1.aaaa.bbbb')).toBe('v1')
      expect(envelopeVersion('v12.aaaa.bbbb')).toBe('v12')
      expect(envelopeVersion('not-an-envelope')).toBeNull()
      expect(envelopeVersion('v0.aaaa.bbbb')).toBeNull()
      expect(envelopeVersion('vX.aaaa.bbbb')).toBeNull()
      expect(envelopeVersion('v1.aaaa')).toBeNull()
    })
  })
})
