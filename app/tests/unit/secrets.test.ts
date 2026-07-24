import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { encryptSecret, decryptSecret } from '@/lib/server/secrets'

// 32 zero bytes, base64. Test-only key.
const KEY = Buffer.alloc(32, 7).toString('base64')
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64')

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
