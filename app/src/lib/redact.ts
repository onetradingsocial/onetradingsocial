/**
 * The redaction layer (audit item 19, finding F4).
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 *
 * Item 19 found only 20 logging calls in the whole application and no secret in
 * any of them — but four of those calls got the *shape* wrong, and they got it
 * wrong independently, because there was nowhere for the decision to live. With
 * no logging layer, every call site decides for itself what is safe to print.
 * The three concrete failures were:
 *
 *   F1  the client error boundary posted `error.message` verbatim into
 *       `analytics_events.props`, where it is stored indefinitely and joined to
 *       a named account by `anon_id`;
 *   F2  the Stripe webhook printed a live `cus_…` id, which is a lookup key
 *       into a customer's whole billing record;
 *   F3  four sites logged a Supabase `PostgrestError` *object*, whose `details`
 *       and `hint` fields Postgres populates with THE OFFENDING ROW VALUES on a
 *       constraint violation — so a failed insert prints user data — and
 *       `reddit-capi.ts` logged the Reddit API's response body, which commonly
 *       echoes the rejected payload back.
 *
 * This module is deliberately **isomorphic**: no `server-only`, no Node
 * imports. `lib/server/log.ts` uses it for server logs and the client error
 * boundaries use it for what they are allowed to send to `/api/track`. One set
 * of rules, one set of tests, both sides of the wire.
 *
 * ── WHAT IT DOES NOT DO ──────────────────────────────────────────────────────
 *
 * Redaction is a net, not a wall. It catches values with a recognisable SHAPE
 * (a JWT, a `cus_` id, an email, an IP, a URL query string) and values behind a
 * recognisable KEY NAME (`password`, `access_token`). It cannot catch a bare
 * column value echoed out of a Postgres error — "duplicate key value violates
 * unique constraint" with the user's own text in it looks like ordinary prose.
 * That is exactly why `describeError` drops `details`/`hint` outright rather
 * than trying to clean them, and why the client boundary sends a CLASSIFIED
 * LABEL rather than a redacted message. Structure beats scrubbing.
 */

/** Long strings in a log line are almost always a payload someone pasted in. */
export const MAX_LOG_STRING = 500

/**
 * Value-shaped rules, applied in order. Order matters: the URL rule runs first
 * because stripping a query string subsumes every secret that might be sitting
 * in one, and the JWT rule runs before the email rule so a token is not partly
 * rewritten by it.
 */
const PATTERNS: Array<[RegExp, string]> = [
  // Query strings are where fetch() failures leak — the URL is in the message
  // and the parameters are whatever the caller put there.
  [/(https?:\/\/[^\s?#]+)\?[^\s#]*/g, '$1?[redacted]'],
  // JSON Web Tokens: Supabase access/refresh tokens, VERCEL_OIDC_TOKEN.
  [/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]+/g, '[jwt]'],
  // Stripe API keys and webhook signing secrets.
  [/\b[sprk]k_(?:live|test)_[A-Za-z0-9]{6,}/g, '[stripe-key]'],
  [/\bwhsec_[A-Za-z0-9]{6,}/g, '[stripe-key]'],
  // F2. A customer id is a lookup key into a full billing record. Subscription
  // ids (`sub_…`) are deliberately NOT redacted: item 19's proposed change is
  // to trace on `sub.id` alone, so it has to stay legible.
  [/\bcus_[A-Za-z0-9]{8,}/g, '[stripe-customer]'],
  // Payment intents, charges, invoices, setup intents, payment methods.
  [/\b(?:pi|ch|in|seti|pm)_[A-Za-z0-9]{14,}/g, '[stripe-object]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]'],
]

/**
 * Key names whose VALUE is never safe to print, whatever it looks like.
 * Anchored so that `author_id` does not match `auth` and `keyboard` does not
 * match `key` — a redactor that eats ordinary identifiers gets switched off.
 */
const SENSITIVE_KEY =
  /^(?:.*[_-])?(password|passphrase|secret|token|apikey|api_key|authorization|cookie|session|credential|credentials|signature|salt|otp|jwt|pin)s?$/i

/** Fields Postgres fills with row values. Never logged, never cleaned — dropped. */
const NEVER_LOG_KEY = /^(details|hint)$/i

export function redactText(input: string): string {
  let out = input
  for (const [re, replacement] of PATTERNS) out = out.replace(re, replacement)
  return out.length > MAX_LOG_STRING ? `${out.slice(0, MAX_LOG_STRING)}…[truncated]` : out
}

const MAX_DEPTH = 4
const MAX_ARRAY = 20
const MAX_KEYS = 40

/**
 * Deep-redact an arbitrary value for logging. Bounded in depth, array length
 * and key count, because the point of a log line is to be read.
 */
export function redactValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return redactText(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return String(value)
  if (typeof value === 'function' || typeof value === 'symbol') return '[omitted]'
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Error) return describeError(value)
  if (depth >= MAX_DEPTH) return '[depth]'

  if (Array.isArray(value)) {
    const head = value.slice(0, MAX_ARRAY).map((v) => redactValue(v, depth + 1))
    return value.length > MAX_ARRAY ? [...head, `…${value.length - MAX_ARRAY} more`] : head
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    let n = 0
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (NEVER_LOG_KEY.test(k)) continue
      if (n >= MAX_KEYS) { out['…'] = 'more keys omitted'; break }
      out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : redactValue(v, depth + 1)
      n += 1
    }
    return out
  }
  return '[omitted]'
}

export type DescribedError = {
  name?: string
  code?: string
  message: string
  digest?: string
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/**
 * Reduce anything that was thrown, or any PostgREST result `error`, to the
 * three fields worth printing.
 *
 * The Supabase case (F3) is the one that matters: a `PostgrestError` is a plain
 * object carrying `{ code, message, details, hint }`, and passing it whole to
 * `console.error` prints all four. `details` and `hint` never survive this
 * function — not truncated, not scrubbed, absent.
 */
export function describeError(err: unknown): DescribedError {
  if (err === null || err === undefined) return { message: 'unknown' }

  if (typeof err === 'string') return { message: redactText(err) }

  if (err instanceof Error) {
    const extra = err as unknown as Record<string, unknown>
    const out: DescribedError = { name: err.name, message: redactText(err.message) }
    if (typeof extra.code === 'string' || typeof extra.code === 'number') out.code = String(extra.code)
    if (typeof extra.digest === 'string') out.digest = extra.digest
    return out
  }

  if (isRecord(err)) {
    const message = typeof err.message === 'string' ? redactText(err.message) : 'unknown'
    // PostgrestError and friends: shaped like an error but not an Error.
    const out: DescribedError = { message }
    if (typeof err.name === 'string') out.name = err.name
    else if ('code' in err && ('details' in err || 'hint' in err)) out.name = 'PostgrestError'
    if (typeof err.code === 'string' || typeof err.code === 'number') out.code = String(err.code)
    if (typeof err.digest === 'string') out.digest = err.digest
    return out
  }

  return { message: redactText(String(err)) }
}

/**
 * ── The client half (F1) ─────────────────────────────────────────────────────
 *
 * `error.tsx` and `global-error.tsx` used to post `error.message` into
 * `analytics_events.props`, which item 1 established has no retention policy and
 * item 17 established is joined to a named account by a permanent `anon_id`. A
 * transient log line became indefinitely-stored, attributable data of
 * unpredictable content, and 300 characters of truncation bounds the volume,
 * not the sensitivity.
 *
 * Redacting that message would not be enough — the dangerous content is a
 * column value or a fragment of application state, which has no recognisable
 * shape. So the boundaries now send a LABEL from this fixed vocabulary instead.
 * Everything unrecognised collapses to `unclassified`, which is deliberately
 * the least useful outcome, because the alternative is storing text nobody
 * vetted. `error.digest` still goes with it, and that is the value that
 * actually correlates to the full server-side stack in Vercel.
 *
 * Minified React error numbers are kept because a number is not user data and
 * it is the single most useful triage signal a production React app emits.
 */
const CLIENT_ERROR_RULES: Array<[RegExp, string]> = [
  [/chunkloaderror|loading chunk \d+ failed|dynamically imported module/i, 'chunk_load'],
  [/hydrat|text content does not match|did not match the server/i, 'hydration'],
  [/failed to fetch|networkerror|load failed|network request failed/i, 'network'],
  [/abort/i, 'aborted'],
  [/timed? ?out/i, 'timeout'],
  [/quota/i, 'storage_quota'],
  [/resizeobserver loop/i, 'resize_observer'],
  // Matched against `"<name> <message>"`, so anchor on whitespace, not on ^.
  [/(?:^|\s)script error\.?\s*$/i, 'cross_origin_script'],
  [/cannot read propert|is not a function|is not iterable|undefined is not an object|null is not an object/i, 'type_error'],
  [/permission denied|not allowed|forbidden|unauthori[sz]ed/i, 'permission_denied'],
  [/out of memory|maximum call stack/i, 'resource_exhausted'],
]

/**
 * Map an uncontrolled client error to a fixed label. Never returns caller text.
 */
export function classifyClientError(message: unknown, name?: unknown): string {
  const reactCode = typeof message === 'string' ? /minified react error #(\d{1,4})/i.exec(message) : null
  if (reactCode) return `react_${reactCode[1]}`

  const haystack = `${typeof name === 'string' ? name : ''} ${typeof message === 'string' ? message : ''}`
  for (const [re, label] of CLIENT_ERROR_RULES) if (re.test(haystack)) return label

  // A well-known constructor name is itself a safe, bounded value.
  if (typeof name === 'string' && /^(TypeError|RangeError|SyntaxError|ReferenceError|EvalError|URIError|AbortError|SecurityError)$/.test(name)) {
    return `js_${name.toLowerCase()}`
  }
  return 'unclassified'
}
