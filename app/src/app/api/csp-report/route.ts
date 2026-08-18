import { NextResponse, type NextRequest } from 'next/server'
import { rateLimit, clientKey, tooMany } from '@/lib/server/rate-limit'
import { logWarn } from '@/lib/server/log'

export const runtime = 'nodejs'

/**
 * CSP violation sink (audit item 17 finding 8; item 2 finding 3).
 *
 * Both Content-Security-Policies were Report-Only with no `report-uri` and no
 * `report-to`, which is the worst of both worlds: the browser computed every
 * violation and then threw it away. That is precisely why the live tag set was
 * able to drift past the policy — three GA4 properties and a Meta CAPI Gateway
 * endpoint on AWS — without anyone seeing a signal.
 *
 * This endpoint exists so the drift becomes visible BEFORE either policy is
 * flipped to enforcing. The marketing origin reports here too (its `report-uri`
 * is the absolute URL of this route), which is why there is no origin check —
 * report-uri POSTs are sent without CORS and may legitimately arrive from
 * www.tradingsocial.io.
 *
 * Deliberately console-only. Reports are attacker-controllable and unauthenticated;
 * writing them to Postgres would hand any passer-by an unbounded insert. Vercel
 * captures stdout, which is enough to answer "what is actually being blocked".
 */

const RATE_MAX = 30
const RATE_WINDOW_MS = 60_000
const MAX_BYTES = 8192

// Extensions and injected content generate enormous volumes of noise against
// any policy. None of these is our code, and logging them buries the real
// signal.
const IGNORED_SCHEMES = /^(chrome-extension|moz-extension|safari-web-extension|about|blob|data):/

export async function POST(req: NextRequest) {
  const rl = rateLimit(`csp:${clientKey(req)}`, RATE_MAX, RATE_WINDOW_MS)
  if (!rl.ok) return tooMany(rl.retryAfter)

  const raw = await req.text().catch(() => '')
  // Always 204: a reporting endpoint must never make a browser retry, and must
  // never tell a prober anything about how its payload was handled.
  if (!raw || raw.length > MAX_BYTES) return new NextResponse(null, { status: 204 })

  try {
    const parsed = JSON.parse(raw)
    // Two wire formats: `report-uri` sends {"csp-report": {...}}, the newer
    // Reporting API `report-to` sends an array of {type, body}.
    const reports: Record<string, unknown>[] = Array.isArray(parsed)
      ? parsed.filter((r) => r?.type === 'csp-violation').map((r) => r.body ?? {})
      : [parsed['csp-report'] ?? parsed]

    for (const r of reports) {
      const blocked = String(r['blocked-uri'] ?? r['blockedURL'] ?? '')
      const source = String(r['source-file'] ?? r['sourceFile'] ?? '')
      if (IGNORED_SCHEMES.test(blocked) || IGNORED_SCHEMES.test(source)) continue
      // Routed through the house logger (item 19 F4) rather than a bare
      // console.warn. It matters more here than almost anywhere else: a CSP
      // report's `blocked-uri` and `document-uri` are browser-supplied URLs, so
      // they arrive with whatever query string the page happened to carry, and
      // this endpoint is unauthenticated — anyone can POST anything to it. The
      // redaction layer strips query strings, tokens and emails out of both.
      logWarn('csp', undefined, {
        directive: r['effective-directive'] ?? r['effectiveDirective'] ?? r['violated-directive'],
        blocked: blocked.slice(0, 300),
        document: String(r['document-uri'] ?? r['documentURL'] ?? '').slice(0, 300),
        disposition: r['disposition'] ?? 'report',
      })
    }
  } catch {
    // Malformed report — nothing actionable, and nothing worth logging.
  }

  return new NextResponse(null, { status: 204 })
}
