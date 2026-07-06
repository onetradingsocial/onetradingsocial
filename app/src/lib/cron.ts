/** Vercel cron sends `authorization: Bearer ${CRON_SECRET}` when the env var
 *  is set. Fails closed when the secret is missing or empty. */
export function authorizedCron(authHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return authHeader === `Bearer ${secret}`
}
