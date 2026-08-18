import 'server-only'
import { describeError, redactValue, type DescribedError } from '@/lib/redact'

/**
 * The house logger (audit item 19, finding F4).
 *
 * ── WHAT THIS REPLACES ───────────────────────────────────────────────────────
 *
 * Twenty bare `console.error` calls, each deciding for itself what was safe to
 * print. Four decided wrong. This is the single place that decision now lives:
 * every server log goes through `logError`/`logWarn`/`logInfo`, the error is
 * reduced to `{ name, code, message }` by `describeError` (so a Supabase
 * `PostgrestError`'s `details`/`hint` — the fields Postgres fills with row
 * values — cannot reach a log sink), and every `meta` value is deep-redacted.
 *
 * The house pattern this generalises is `actions/social.ts:118-257`, which item
 * 19 singled out as already correct: it logs `error.message` and nothing else.
 * The helper keeps that behaviour and adds the error code back, which is the
 * one field that was being thrown away and is the most useful for triage.
 *
 * ── OUTPUT SHAPE, AND WHY ────────────────────────────────────────────────────
 *
 *   console.error('[stripe webhook]', '{"err":{"name":…},"sub":"sub_123"}')
 *
 * The bracketed scope stays a plain prefix because every existing log line in
 * this codebase has one and people grep for them. Everything after it is a
 * single JSON object, so that the day a log drain or an error monitor is added
 * the lines are already machine-readable and already scrubbed — the scrubber
 * is here, not in the vendor's dashboard, which means it also applies to the
 * Vercel console where the logs live today.
 *
 * ── WHAT A MONITOR WOULD ADD, AND WHY IT IS NOT HERE ─────────────────────────
 *
 * This helper fixes *what* is logged. It does not fix that nothing READS the
 * logs. Server errors exist only as unstructured lines in the Vercel console,
 * on Hobby's ~1 hour runtime-log retention, with no alerting: the one alerting
 * path, `api/cron/error-alert`, counts `analytics_events` rows, so it sees only
 * errors the CLIENT reported and never a server-side 500. That is why item 12's
 * silently-broken Stripe mirror went unnoticed for 18 days.
 *
 * A monitoring service (Sentry, Highlight, Axiom) would add: durable retention,
 * grouping and deduplication, a first-seen/last-seen timeline, release
 * correlation, stack traces with source maps, and — the one that matters here —
 * an alert the moment a NEW error class appears rather than a daily count of
 * client-reported ones. Adopting one is an owner decision because it is a cost
 * and a fifth data processor to disclose in `privacy.html` section 5, so it is
 * written up in ws8-hygiene.md rather than installed. If it is adopted, this is
 * the file it hooks into: add the transport in `emit()` and every call site is
 * already routed and already redacted.
 *
 * `raiseAlert` (lib/server/alerts.ts) remains the escalation path for the
 * conditions that genuinely need a human today; a log line is not an alert.
 */

type Meta = Record<string, unknown>
type Level = 'error' | 'warn' | 'info'

export type LogEntry = {
  scope: string
  err?: DescribedError
} & Meta

/**
 * Build the payload without emitting it. Exported for tests — asserting on a
 * returned object is a far better regression guard than spying on console.
 */
export function buildLogEntry(scope: string, err: unknown, meta?: Meta): LogEntry {
  const entry: LogEntry = { scope }
  if (err !== undefined) entry.err = describeError(err)
  if (meta) {
    for (const [k, v] of Object.entries(meta)) {
      if (k === 'scope' || k === 'err') continue
      entry[k] = redactValue(v)
    }
  }
  return entry
}

function emit(level: Level, scope: string, err: unknown, meta?: Meta): void {
  const entry = buildLogEntry(scope, err, meta)
  const { scope: _scope, ...rest } = entry
  let line: string
  try {
    line = JSON.stringify(rest)
  } catch {
    // Circular reference somewhere in meta. Never let logging throw.
    line = '{"err":{"message":"log serialisation failed"}}'
  }
  const write = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info
  write(`[${scope}]`, line)
}

/** Log a failure. `err` may be an Error, a PostgrestError, a string, anything. */
export function logError(scope: string, err: unknown, meta?: Meta): void {
  emit('error', scope, err, meta)
}

/** Log a recoverable condition. Same redaction, lower severity. */
export function logWarn(scope: string, err: unknown, meta?: Meta): void {
  emit('warn', scope, err, meta)
}

/**
 * Log a notable success. `meta` only — there is no error to describe, and
 * passing `undefined` keeps the `err` key out of the payload entirely.
 */
export function logInfo(scope: string, meta?: Meta): void {
  emit('info', scope, undefined, meta)
}
