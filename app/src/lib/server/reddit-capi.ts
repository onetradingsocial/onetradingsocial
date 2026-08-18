import 'server-only'
import { buildConversionBody, type ConversionInput } from '@/lib/reddit-capi'
import { logError } from '@/lib/server/log'

const PIXEL_ID = process.env.NEXT_PUBLIC_REDDIT_PIXEL_ID || 'a2_jbawbd7fkiwo'
const ENDPOINT = `https://ads-api.reddit.com/api/v3/pixels/${PIXEL_ID}/conversion_events`
const TIMEOUT_MS = 3000

// Fire a Reddit conversion. Best-effort: never throws, no-ops when the token is
// unset. Callers should not await this on a user-facing hot path (use after()).
export async function sendRedditConversion(input: ConversionInput): Promise<void> {
  const token = process.env.REDDIT_CONVERSIONS_TOKEN
  if (!token) return

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildConversionBody(input)),
      signal: controller.signal,
    })
    if (!res.ok) {
      // Audit item 19 F3. This used to log `await res.text()` — the Reddit API's
      // response body — and that is the one thing in this call worth NOT
      // printing. The request carries a hashed email and a hashed account id
      // (and a hashed IP if REDDIT_CAPI_SEND_IP is ever turned on), and an API
      // error conventionally echoes the rejected payload back. The status code
      // is all the triage this best-effort call supports anyway: 401/403 is the
      // token, 400 is the schema, 5xx is Reddit.
      logError('reddit-capi', undefined, { note: 'non-ok response', status: res.status })
    }
  } catch (err) {
    logError('reddit-capi', err, { note: 'send failed' })
  } finally {
    clearTimeout(timer)
  }
}
