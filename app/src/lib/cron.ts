import { createHash, timingSafeEqual } from 'node:crypto'

const digest = (s: string) => createHash('sha256').update(s).digest()

/** Vercel cron sends `authorization: Bearer ${CRON_SECRET}` when the env var
 *  is set. Fails closed when the secret is missing or empty.
 *
 *  Compared in constant time. A plain `===` returns at the first differing
 *  byte, which in principle lets a caller recover the secret from response
 *  timing. Both sides are hashed first so `timingSafeEqual` always sees equal
 *  lengths and the secret's length is not leaked either. Every caller runs on
 *  the Node runtime, so `node:crypto` is available. */
export function authorizedCron(authHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret || authHeader == null) return false
  return timingSafeEqual(digest(authHeader), digest(`Bearer ${secret}`))
}
