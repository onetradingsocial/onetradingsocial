import 'server-only'
import { cache } from 'react'
import { headers } from 'next/headers'
import type { User } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'

/** PostgREST: the column does not exist (migration 0052 not applied yet). */
const UNDEFINED_COLUMN = '42703'
/** PostgREST: the column is not in the cached schema — same cause, different path. */
const SCHEMA_CACHE_MISS = 'PGRST204'

/** Longest user-agent we keep. Real ones are ~120 chars; the cap is anti-abuse. */
const UA_MAX = 512

/**
 * Very deliberately permissive but bounded. The column is `inet`, so a value
 * Postgres cannot parse would fail the whole insert; anything that does not
 * look like an address is dropped to null rather than risking the audit row.
 */
const IPISH = /^[0-9a-fA-F:.]{3,45}$/

type AuditRow = {
  actor_id: string | null
  actor_email: string | null
  action: string
  target_type: string | null
  target_id: string | null
  detail: Record<string, unknown>
  ip?: string | null
  user_agent?: string | null
}

/**
 * Request metadata for the audit row (F5). Best-effort by design: `headers()`
 * throws outside a request scope (a script, a test), and an audit row with no
 * IP is worth far more than no audit row.
 *
 * `x-forwarded-for` is a client-controllable header. On Vercel the platform
 * *prepends* the real peer address, so the FIRST hop is the trustworthy one —
 * taking the last would record whatever the caller wrote. It is still evidence
 * rather than proof, which is the correct standing for anything in a log.
 */
async function requestContext(): Promise<{ ip: string | null; user_agent: string | null }> {
  try {
    const h = await headers()
    const fwd = h.get('x-forwarded-for') ?? ''
    const first = fwd.split(',')[0]?.trim() ?? ''
    const ip = IPISH.test(first) ? first : null
    const ua = h.get('user-agent')
    return { ip, user_agent: ua ? ua.slice(0, UA_MAX) : null }
  } catch {
    return { ip: null, user_agent: null }
  }
}

/**
 * Insert, and fall back to the pre-0052 column set if `ip`/`user_agent` do not
 * exist yet. Same contract as WS3's `preserveModerationRecords`: the code ships
 * before the migration and is inert, not broken, until it lands. Without the
 * retry a deploy-before-migrate would silently stop auditing *everything*,
 * which is a worse outcome than the finding it fixes.
 */
async function insertAudit(row: AuditRow): Promise<void> {
  const svc = createServiceClient()
  const { error } = await svc.from('admin_audit').insert(row)
  if (!error) return
  if (error.code === UNDEFINED_COLUMN || error.code === SCHEMA_CACHE_MISS) {
    const { ip: _ip, user_agent: _ua, ...legacy } = row
    void _ip
    void _ua
    await svc.from('admin_audit').insert(legacy)
    return
  }
  throw new Error(error.message)
}

/**
 * Record a privileged admin action (row 52). Fire-and-forget: an audit failure
 * must never block the action itself, but every admin mutation should call it.
 */
export async function logAdminAction(
  admin: User,
  action: string,
  target?: { type?: string; id?: string | number },
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    const ctx = await requestContext()
    await insertAudit({
      actor_id: admin.id,
      actor_email: admin.email ?? null,
      action,
      target_type: target?.type ?? null,
      target_id: target?.id != null ? String(target.id) : null,
      detail,
      ip: ctx.ip,
      user_agent: ctx.user_agent,
    })
  } catch {
    // swallow — auditing is observability, not a gate
  }
}

/**
 * Record an admin **read** of one identifiable person's data. Audit item 18, F4.
 *
 * ## What gets logged, and what deliberately does not
 *
 * The rule is *one person's record, or one person's identifier* — not "an admin
 * looked at a page". Logging every render of an aggregate dashboard produces a
 * table nobody reads, and a log nobody reads answers no question in an incident.
 *
 * **Logged** (`user.view`, `users.search`, `user.email.reveal`,
 * `broker.login.reveal`, `interviews.email.reveal`): opening one user's detail
 * page, searching the directory by a term, and every reveal of a masked email
 * or broker login. These are the acts that put a specific person's identifier
 * in front of a human, which is the harm the log exists to make visible.
 *
 * **Not logged**: /admin, /admin/analytics, /admin/cohorts, /admin/audit,
 * /admin/courses/*, /admin/features, /admin/feedback, /admin/referrals, the
 * unfiltered first page of /admin/users, and the /admin/interviews and
 * /admin/verification list renders. Every one of those is either an aggregate,
 * a content screen, or a queue that now shows only usernames and masked
 * identifiers — nothing there singles out a person's personal data, and the
 * reveals on top of them are logged individually.
 *
 * ## Why it is deduplicated per request
 *
 * These fire from Server Components. A single navigation can render a segment
 * more than once (dev double-render, an RSC prefetch followed by the real
 * request), and three identical `user.view` rows one millisecond apart are
 * noise that makes a genuine repeat visit harder to see. React's `cache()`
 * collapses identical calls **within one request** and does nothing across
 * requests, so a real second visit still records a second row.
 *
 * The memoised function takes **primitives only**. `cache()` keys on argument
 * identity, so passing the `User` object and a fresh `{ type, id }` literal
 * would miss the memo on every call and defeat the whole point.
 */
const logReadOnce = cache(
  async (
    actorId: string,
    actorEmail: string | null,
    action: string,
    targetType: string | null,
    targetId: string | null,
    detailJson: string,
  ): Promise<void> => {
    const ctx = await requestContext()
    await insertAudit({
      actor_id: actorId,
      actor_email: actorEmail,
      action,
      target_type: targetType,
      target_id: targetId,
      detail: JSON.parse(detailJson) as Record<string, unknown>,
      ip: ctx.ip,
      user_agent: ctx.user_agent,
    })
  },
)

export async function logAdminRead(
  admin: User,
  action: string,
  target?: { type?: string; id?: string | number },
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    await logReadOnce(
      admin.id,
      admin.email ?? null,
      action,
      target?.type ?? null,
      target?.id != null ? String(target.id) : null,
      JSON.stringify(detail),
    )
  } catch {
    // swallow — same reasoning as logAdminAction
  }
}
