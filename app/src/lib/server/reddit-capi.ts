import 'server-only'
import { buildConversionBody, type ConversionInput } from '@/lib/reddit-capi'

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
      const detail = await res.text().catch(() => '')
      console.error('[reddit-capi] non-ok response', res.status, detail)
    }
  } catch (err) {
    console.error('[reddit-capi] send failed', err)
  } finally {
    clearTimeout(timer)
  }
}
