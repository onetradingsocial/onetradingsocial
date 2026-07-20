import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Cohort-retention dashboard (Sprint 3, row 47). "Retained on day N" = the
 * user had activity (trade/post/comment/like/lesson) on or after signup+N days.
 * Weekly signup cohorts + breakdowns by acquisition source, account type,
 * market and device. Internal profiles excluded.
 */

export type CohortRow = {
  cohort: string          // week label (YYYY-MM-DD, Monday)
  size: number
  d1: number; d7: number; d30: number   // retained counts
}

export type Breakdown = { key: string; size: number; d1: number; d7: number; d30: number }

export type CohortDashboard = {
  cohorts: CohortRow[]
  bySource: Breakdown[]
  byAccountType: Breakdown[]
  byMarket: Breakdown[]
  byDevice: Breakdown[]
}

const DAY = 864e5

function weekStart(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dow = (x.getUTCDay() + 6) % 7
  x.setUTCDate(x.getUTCDate() - dow)
  return x.toISOString().slice(0, 10)
}

export async function getCohortDashboard(svc: SupabaseClient, now = new Date()): Promise<CohortDashboard> {
  const { data: profs } = await svc
    .from('profiles')
    .select('id, created_at, acquisition_source, account_type, main_markets')
    .eq('is_internal', false)
  const profiles = profs ?? []
  const ids = profiles.map((p) => p.id)
  const idGuard = ids.length ? ids : ['00000000-0000-0000-0000-000000000000']

  // Activity timestamps per user across the engagement surfaces.
  const [trades, posts, comments, likes, completions, pvDevice] = await Promise.all([
    svc.from('trades').select('user_id, created_at').in('user_id', idGuard),
    svc.from('posts').select('author_id, created_at').in('author_id', idGuard),
    svc.from('comments').select('author_id, created_at').in('author_id', idGuard),
    svc.from('likes').select('user_id, created_at').in('user_id', idGuard),
    svc.from('lesson_completions').select('user_id, completed_at').in('user_id', idGuard),
    // Device = first page_view device per user (analytics_events).
    svc.from('analytics_events').select('user_id, device, created_at').eq('event', 'page_view').in('user_id', idGuard).limit(20000),
  ])

  const activity = new Map<string, number[]>() // user -> activity epoch ms
  const push = (uid: string | null, ts: string | null) => {
    if (!uid || !ts) return
    const t = Date.parse(ts)
    if (Number.isNaN(t)) return
    const arr = activity.get(uid) ?? []
    arr.push(t)
    activity.set(uid, arr)
  }
  for (const r of trades.data ?? []) push(r.user_id, r.created_at)
  for (const r of posts.data ?? []) push(r.author_id, r.created_at)
  for (const r of comments.data ?? []) push(r.author_id, r.created_at)
  for (const r of likes.data ?? []) push(r.user_id, r.created_at)
  for (const r of completions.data ?? []) push(r.user_id, r.completed_at)

  // First device seen per user.
  const device = new Map<string, string>()
  for (const r of (pvDevice.data ?? []).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))) {
    if (r.user_id && r.device && !device.has(r.user_id)) device.set(r.user_id, r.device)
  }

  // Retained on day N = at least N days elapsed since signup AND the user had
  // activity on or after signup+N days.
  const retained = (uid: string, signupMs: number, day: number): boolean => {
    if (now.getTime() < signupMs + day * DAY) return false
    return (activity.get(uid) ?? []).some((t) => t >= signupMs + day * DAY)
  }

  type Acc = { size: number; d1: number; d7: number; d30: number }
  const blank = (): Acc => ({ size: 0, d1: 0, d7: 0, d30: 0 })
  const add = (acc: Acc, uid: string, signupMs: number) => {
    acc.size++
    if (retained(uid, signupMs, 1)) acc.d1++
    if (retained(uid, signupMs, 7)) acc.d7++
    if (retained(uid, signupMs, 30)) acc.d30++
  }

  const cohorts = new Map<string, Acc>()
  const bySource = new Map<string, Acc>()
  const byAccount = new Map<string, Acc>()
  const byMarket = new Map<string, Acc>()
  const byDevice = new Map<string, Acc>()
  const bump = (m: Map<string, Acc>, key: string, uid: string, signupMs: number) => {
    const a = m.get(key) ?? blank(); add(a, uid, signupMs); m.set(key, a)
  }

  for (const p of profiles) {
    const signupMs = Date.parse(p.created_at)
    if (Number.isNaN(signupMs)) continue
    bump(cohorts, weekStart(new Date(signupMs)), p.id, signupMs)
    bump(bySource, p.acquisition_source || '(direct)', p.id, signupMs)
    bump(byAccount, p.account_type || 'unspecified', p.id, signupMs)
    bump(byDevice, device.get(p.id) || 'unknown', p.id, signupMs)
    const markets: string[] = p.main_markets ?? []
    bump(byMarket, markets[0] || 'unspecified', p.id, signupMs)
  }

  const toRows = (m: Map<string, Acc>): Breakdown[] =>
    [...m.entries()].map(([key, a]) => ({ key, ...a })).sort((x, y) => y.size - x.size)

  return {
    cohorts: [...cohorts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([cohort, a]) => ({ cohort, size: a.size, d1: a.d1, d7: a.d7, d30: a.d30 })),
    bySource: toRows(bySource),
    byAccountType: toRows(byAccount),
    byMarket: toRows(byMarket),
    byDevice: toRows(byDevice),
  }
}
