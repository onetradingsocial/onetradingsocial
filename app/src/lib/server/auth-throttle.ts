import 'server-only'

import { createHash } from 'node:crypto'
import { headers } from 'next/headers'
import { rateLimit } from '@/lib/server/rate-limit'

/**
 * Throttling for the credential-handling server actions (item 9 F10).
 *
 * ── READ THIS BEFORE TRUSTING IT ─────────────────────────────────────────────
 * It is built on `lib/server/rate-limit.ts`, whose state is a Map in one
 * serverless instance's memory. It therefore resets on cold start and is not
 * shared between instances. Against a distributed credential-stuffing run on
 * Vercel it is close to useless, and nothing here should be read as claiming
 * otherwise. What it DOES buy, today, for free:
 *
 *   - a single scripted client hammering one email is stopped;
 *   - we stop forwarding that traffic to GoTrue, whose per-IP limit is the
 *     control actually doing the work and which the app already trips often
 *     enough to have written friendly copy for it;
 *   - the call sites, the keys and the budgets are now in code, so swapping the
 *     backing store is a one-file change.
 *
 * A durable store (Upstash/Redis) is WS8's problem. Do not solve it here.
 *
 * ── Design notes ─────────────────────────────────────────────────────────────
 * Two independent buckets per attempt, per-IP and per-email, because they fail
 * differently: per-IP catches one host trying many accounts, per-email catches
 * many hosts trying one account. Either tripping is enough to refuse.
 *
 * Emails are SHA-256'd before they become map keys — a rate-limiter is not a
 * place to accumulate a plaintext list of who tried to log in.
 */

/** Attempts per window. Generous enough that a real user fat-fingering their
 *  password three times in a row is never affected. */
export const LOGIN_MAX_PER_EMAIL = 10
export const LOGIN_MAX_PER_IP = 30
export const LOGIN_WINDOW_MS = 15 * 60 * 1000

/** Reset requests are cheap for us and expensive for the recipient's inbox, so
 *  they are tighter — and GoTrue enforces its own per-address cooldown too. */
export const RESET_MAX_PER_EMAIL = 3
export const RESET_MAX_PER_IP = 10
export const RESET_WINDOW_MS = 60 * 60 * 1000

export type ThrottleBudget = {
  scope: string
  maxPerEmail: number
  maxPerIp: number
  windowMs: number
}

export const LOGIN_BUDGET: ThrottleBudget = {
  scope: 'login',
  maxPerEmail: LOGIN_MAX_PER_EMAIL,
  maxPerIp: LOGIN_MAX_PER_IP,
  windowMs: LOGIN_WINDOW_MS,
}

export const SIGNUP_BUDGET: ThrottleBudget = {
  scope: 'signup',
  maxPerEmail: RESET_MAX_PER_EMAIL,
  maxPerIp: LOGIN_MAX_PER_IP,
  windowMs: RESET_WINDOW_MS,
}

export const RESET_BUDGET: ThrottleBudget = {
  scope: 'reset',
  maxPerEmail: RESET_MAX_PER_EMAIL,
  maxPerIp: RESET_MAX_PER_IP,
  windowMs: RESET_WINDOW_MS,
}

function emailKey(scope: string, email: string): string {
  const norm = email.trim().toLowerCase()
  return `${scope}:e:${createHash('sha256').update(norm).digest('hex').slice(0, 32)}`
}

/**
 * Best-effort caller IP from the proxy headers Vercel sets. `x-forwarded-for`
 * is client-controlled in general, but on Vercel the platform overwrites the
 * leftmost entry, so the first hop is trustworthy in production.
 */
async function callerIp(): Promise<string> {
  try {
    const h = await headers()
    const fwd = h.get('x-forwarded-for')?.split(',')[0]?.trim()
    return fwd || h.get('x-real-ip') || 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Consume one attempt. Returns false when the caller should be refused.
 *
 * Both buckets are always consumed — never short-circuited — so a caller that
 * trips the email bucket still counts against its IP budget and cannot use a
 * rotating list of addresses to keep the IP bucket empty.
 */
export async function allowAuthAttempt(budget: ThrottleBudget, email: string): Promise<boolean> {
  const ip = await callerIp()
  const byEmail = rateLimit(emailKey(budget.scope, email), budget.maxPerEmail, budget.windowMs)
  const byIp = rateLimit(`${budget.scope}:ip:${ip}`, budget.maxPerIp, budget.windowMs)
  return byEmail.ok && byIp.ok
}
