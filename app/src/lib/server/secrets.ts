import 'server-only'
import { webcrypto } from 'node:crypto'

// AES-256-GCM envelope for user secrets (exchange API keys). The master key
// lives only in the environment — never in Postgres — so a database dump on
// its own is inert. Fails closed: there is no plaintext fallback path, and
// neither plaintext nor ciphertext is ever put in an error message.
const VERSION = 'v1'
const IV_BYTES = 12

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'))

async function masterKey(): Promise<CryptoKey> {
  const raw = process.env.EXCHANGE_KEY_SECRET
  if (!raw) throw new Error('EXCHANGE_KEY_SECRET is not set')
  const bytes = unb64(raw)
  if (bytes.length !== 32) throw new Error('EXCHANGE_KEY_SECRET must decode to 32 bytes')
  return webcrypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function encryptSecret(plain: string): Promise<string> {
  if (!plain) throw new Error('encryptSecret: empty input')
  const key = await masterKey()
  const iv = webcrypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ct = new Uint8Array(
    await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)),
  )
  return `${VERSION}.${b64(iv)}.${b64(ct)}`
}

export async function decryptSecret(enc: string): Promise<string> {
  const parts = enc.split('.')
  if (parts.length !== 3 || parts[0] !== VERSION) {
    throw new Error('decryptSecret: malformed envelope')
  }
  const key = await masterKey()
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
