# Leaderboard (Phase 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rank traders over their public closed trades and replace the home/profile rank placeholders with real positions, plus a dedicated `/app/leaderboard` page (podium + table + rank card).

**Architecture:** A pure, unit-tested ranking core (`lib/leaderboard.ts`) does all aggregation/sorting with zero I/O. A thin server helper (`lib/server/ranking.ts`) runs the Supabase query, joins profiles, and returns a ranked list reused by the board page, the home right rail, the home race, and the profile rank. UI is server components for data + small client components for the URL-driven tabs/controls. No DB migration — read-only over `trades`, `follows`, `profiles`.

**Tech Stack:** Next.js App Router (TS), Supabase (`@supabase/ssr` server client), Vitest (unit), Playwright (e2e). Path alias `@/` → `app/src/`.

---

## File Structure

```
app/src/lib/leaderboard.ts                       # CREATE pure aggregate + rank + windowStart
app/src/lib/server/ranking.ts                    # CREATE getPerformanceRanking(supabase, period, sort)
app/src/app/leaderboard/page.tsx                 # CREATE board page (server component)
app/src/app/leaderboard/_components/
    LeaderboardTabs.tsx                          # CREATE client — category tabs
    LeaderboardControls.tsx                      # CREATE client — period segmented + sort dropdown
    Podium.tsx                                   # CREATE presentational — top 3
    LeaderboardTable.tsx                         # CREATE presentational — ranked rows + BoardRow type
    RankCard.tsx                                 # CREATE presentational — viewer rank card
app/src/app/_components/NavLinks.tsx             # MODIFY — Leaderboard real <Link>
app/src/app/feed/_components/RightRail.tsx       # MODIFY — real top-5 week board
app/src/app/feed/_components/WelcomeHero.tsx     # MODIFY — real standing rank + top-3 race
app/src/app/[username]/page.tsx                  # MODIFY — real all-time rank stat
app/src/app/globals.css                          # MODIFY — podium / table / rank card styles
app/tests/unit/leaderboard.test.ts               # CREATE
app/tests/e2e/leaderboard.spec.ts                # CREATE
```

**Conventions confirmed from the codebase (do not re-derive):**
- Server client: `import { createClient } from '@/lib/supabase/server'`; `const supabase = await createClient()`.
- Trades default `is_public = true` (migration 0002). Leaderboard reads `is_public = true and status = 'closed'`.
- `outcome` is `'win' | 'loss' | 'breakeven' | 'open'`. `pnl_amount` / `r_multiple` are `number | null`.
- Profiles visible only when `is_public = true and onboarding_completed = true`.
- Existing rail classes to reuse: `ts-card`, `ts-railcard`, `ts-rail-head`, `ts-h2`, `ts-lb`, `ts-lb-row`, `ts-lb-num`, `ts-lb-num--N`, `ts-lb-val`, `ts-soon`, `ts-pos`, `ts-neg`, `ts-navpill`.
- `UserLink` props: `{ username, displayName, avatarUrl }`. `FollowButton` props: `{ targetId, initialFollowing }`.
- All app routes live under basePath `/app`; in-app `<Link href="/leaderboard">` resolves to `/app/leaderboard`. Playwright base URL already includes `/app` (specs use `page.goto('/app/...')`).

---

## Task 1: Pure ranking core + unit tests

**Files:**
- Create: `app/src/lib/leaderboard.ts`
- Test: `app/tests/unit/leaderboard.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/tests/unit/leaderboard.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  aggregatePerformance, rankPerformance, rankConsistency, rankFollowers, windowStart,
  type PerfTrade,
} from '@/lib/leaderboard'

const t = (user_id: string, pnl_amount: number, r_multiple: number, outcome: string): PerfTrade =>
  ({ user_id, pnl_amount, r_multiple, outcome })

describe('aggregatePerformance', () => {
  it('sums pnl, counts wins/losses, means R, computes winRate per user', () => {
    const m = aggregatePerformance([
      t('u1', 100, 2, 'win'), t('u1', -50, -1, 'loss'), t('u2', 30, 1.5, 'win'),
    ])
    expect(m.get('u1')).toEqual({ userId: 'u1', pnl: 50, wins: 1, losses: 1, winRate: 0.5, avgR: 0.5, trades: 2 })
    expect(m.get('u2')).toEqual({ userId: 'u2', pnl: 30, wins: 1, losses: 0, winRate: 1, avgR: 1.5, trades: 1 })
  })
  it('treats null pnl/r as zero and ignores non win/loss outcomes in wins/losses', () => {
    const a = aggregatePerformance([t('u1', null as unknown as number, null as unknown as number, 'breakeven')]).get('u1')!
    expect(a.pnl).toBe(0); expect(a.avgR).toBe(0); expect(a.wins).toBe(0); expect(a.losses).toBe(0); expect(a.trades).toBe(1)
  })
})

describe('rankPerformance', () => {
  const aggs = [...aggregatePerformance([
    t('a', 300, 1, 'win'), t('a', 0, 1, 'win'),        // a: pnl 300, trades 2
    t('b', 300, 5, 'win'),                              // b: pnl 300, trades 1
    t('c', 100, 9, 'win'),                              // c: pnl 100, trades 1
  ]).values()]

  it('default sorts by pnl desc, tie-break trades desc then pnl desc, dense rank', () => {
    const r = rankPerformance(aggs)              // default 'pnl'
    expect(r.map((x) => x.userId)).toEqual(['a', 'b', 'c']) // a & b tie 300 -> a first (more trades)
    expect(r.map((x) => x.rank)).toEqual([1, 1, 2])         // dense: equal pnl share rank
  })
  it('sorts by trades / winRate / avgR', () => {
    expect(rankPerformance(aggs, 'trades').map((x) => x.userId)).toEqual(['a', 'b', 'c'])
    expect(rankPerformance(aggs, 'avgR').map((x) => x.userId)).toEqual(['c', 'b', 'a'])
  })
})

describe('rankConsistency', () => {
  it('counts logged trades per user, ranked desc, dense rank', () => {
    const r = rankConsistency([{ user_id: 'a' }, { user_id: 'a' }, { user_id: 'b' }])
    expect(r).toEqual([{ userId: 'a', count: 2, rank: 1 }, { userId: 'b', count: 1, rank: 2 }])
  })
})

describe('rankFollowers', () => {
  it('counts followers per following_id, ranked desc', () => {
    const r = rankFollowers([{ following_id: 'x' }, { following_id: 'x' }, { following_id: 'y' }])
    expect(r).toEqual([{ userId: 'x', count: 2, rank: 1 }, { userId: 'y', count: 1, rank: 2 }])
  })
})

describe('windowStart', () => {
  const now = new Date('2026-06-19T00:00:00Z').getTime()
  it('week = now-7d, month = now-30d, all = null', () => {
    expect(windowStart('week', now)).toBe('2026-06-12T00:00:00.000Z')
    expect(windowStart('month', now)).toBe('2026-05-20T00:00:00.000Z')
    expect(windowStart('all', now)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app && npm test -- leaderboard`
Expected: FAIL — `Cannot find module '@/lib/leaderboard'`.

- [ ] **Step 3: Implement the pure core**

Create `app/src/lib/leaderboard.ts`:

```ts
export type Period = 'week' | 'month' | 'all'
export type PerfSort = 'pnl' | 'winRate' | 'avgR' | 'trades'

export type PerfTrade = { user_id: string; pnl_amount: number | null; r_multiple: number | null; outcome: string }
export type Agg = { userId: string; pnl: number; wins: number; losses: number; winRate: number; avgR: number; trades: number }
export type RankedPerf = Agg & { rank: number }
export type RankedCount = { userId: string; count: number; rank: number }

export function aggregatePerformance(trades: PerfTrade[]): Map<string, Agg> {
  const m = new Map<string, Agg>()
  for (const t of trades) {
    const a = m.get(t.user_id) ?? { userId: t.user_id, pnl: 0, wins: 0, losses: 0, winRate: 0, avgR: 0, trades: 0 }
    a.pnl += t.pnl_amount ?? 0
    a.avgR += t.r_multiple ?? 0 // running sum; divided to a mean below
    if (t.outcome === 'win') a.wins += 1
    else if (t.outcome === 'loss') a.losses += 1
    a.trades += 1
    m.set(t.user_id, a)
  }
  for (const a of m.values()) {
    a.winRate = a.trades ? a.wins / a.trades : 0
    a.avgR = a.trades ? a.avgR / a.trades : 0
  }
  return m
}

const perfKey = (a: Agg, sort: PerfSort): number =>
  sort === 'pnl' ? a.pnl : sort === 'winRate' ? a.winRate : sort === 'avgR' ? a.avgR : a.trades

export function rankPerformance(aggs: Agg[], sort: PerfSort = 'pnl'): RankedPerf[] {
  const sorted = [...aggs].sort(
    (a, b) => perfKey(b, sort) - perfKey(a, sort) || b.trades - a.trades || b.pnl - a.pnl,
  )
  let rank = 0
  let prev: number | null = null
  return sorted.map((a) => {
    const k = perfKey(a, sort)
    if (prev === null || k !== prev) { rank += 1; prev = k } // dense rank on the chosen key
    return { ...a, rank }
  })
}

function rankCounts(counts: Map<string, number>): RankedCount[] {
  const arr = [...counts.entries()].map(([userId, count]) => ({ userId, count }))
  arr.sort((a, b) => b.count - a.count || a.userId.localeCompare(b.userId))
  let rank = 0
  let prev: number | null = null
  return arr.map((r) => {
    if (prev === null || r.count !== prev) { rank += 1; prev = r.count }
    return { ...r, rank }
  })
}

export function rankConsistency(trades: { user_id: string }[]): RankedCount[] {
  const counts = new Map<string, number>()
  for (const t of trades) counts.set(t.user_id, (counts.get(t.user_id) ?? 0) + 1)
  return rankCounts(counts)
}

export function rankFollowers(follows: { following_id: string }[]): RankedCount[] {
  const counts = new Map<string, number>()
  for (const f of follows) counts.set(f.following_id, (counts.get(f.following_id) ?? 0) + 1)
  return rankCounts(counts)
}

export function windowStart(period: Period, now: number): string | null {
  if (period === 'all') return null
  const days = period === 'week' ? 7 : 30
  return new Date(now - days * 864e5).toISOString()
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app && npm test -- leaderboard`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/leaderboard.ts app/tests/unit/leaderboard.test.ts
git commit -m "feat(app): pure leaderboard ranking core + unit tests"
```

---

## Task 2: Shared server ranking helper

**Files:**
- Create: `app/src/lib/server/ranking.ts`

This wraps the Performance query so the board page, home rail, home race, and profile rank all share one code path. Aggregation happens before the profile join so private/missing profiles are dropped *before* ranking → dense ranks have no gaps (spec §3.3).

- [ ] **Step 1: Implement the helper**

Create `app/src/lib/server/ranking.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  aggregatePerformance, rankPerformance, windowStart,
  type PerfTrade, type Period, type PerfSort,
} from '@/lib/leaderboard'

export type RankedEntry = {
  rank: number
  userId: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  pnl: number
  winRate: number
  avgR: number
  trades: number
}

// Public closed trades -> aggregate -> keep only visible profiles -> rank -> attach profile fields.
export async function getPerformanceRanking(
  supabase: SupabaseClient,
  period: Period,
  sort: PerfSort = 'pnl',
): Promise<RankedEntry[]> {
  const cutoff = windowStart(period, Date.now())
  let q = supabase
    .from('trades')
    .select('user_id, pnl_amount, r_multiple, outcome, traded_at')
    .eq('is_public', true)
    .eq('status', 'closed')
  if (cutoff) q = q.gte('traded_at', cutoff)
  const { data: rows } = await q

  const aggs = [...aggregatePerformance((rows ?? []) as PerfTrade[]).values()]
  if (aggs.length === 0) return []

  const { data: profs } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url')
    .in('id', aggs.map((a) => a.userId))
    .eq('is_public', true)
    .eq('onboarding_completed', true)
  const pmap = new Map((profs ?? []).map((p) => [p.id, p]))

  const visible = aggs.filter((a) => pmap.has(a.userId))
  return rankPerformance(visible, sort).map((r) => {
    const p = pmap.get(r.userId)!
    return {
      rank: r.rank, userId: r.userId,
      username: p.username, displayName: p.display_name, avatarUrl: p.avatar_url,
      pnl: r.pnl, winRate: r.winRate, avgR: r.avgR, trades: r.trades,
    }
  })
}
```

- [ ] **Step 2: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: no errors. (If `@supabase/supabase-js` types are unavailable, this import is already used elsewhere — verify with `grep -r "from '@supabase/supabase-js'" src`; if absent, type the param as `Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>` instead.)

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/server/ranking.ts
git commit -m "feat(app): shared getPerformanceRanking server helper"
```

---

## Task 3: Presentational components (Podium, Table, RankCard)

**Files:**
- Create: `app/src/app/leaderboard/_components/LeaderboardTable.tsx` (defines `BoardRow`)
- Create: `app/src/app/leaderboard/_components/Podium.tsx`
- Create: `app/src/app/leaderboard/_components/RankCard.tsx`

`BoardRow` is the normalized row every category maps into, so Podium and Table render identically across Performance/Consistency/Most Followed.

- [ ] **Step 1: Create `LeaderboardTable.tsx`**

```tsx
import { UserLink } from '@/app/_components/UserLink'
import { FollowButton } from '@/app/_components/FollowButton'

export type BoardRow = {
  rank: number
  userId: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  headline: string        // formatted metric, e.g. "+$160" or "12 trades"
  barPct: number          // 0..100 proportion bar width
  winRate: number | null  // null hides the cell (non-performance categories)
  avgR: number | null
  trades: number | null
}

const pct = (n: number | null) => (n == null ? '—' : `${Math.round(n * 100)}%`)
const r2 = (n: number | null) => (n == null ? '—' : `${n.toFixed(2)}R`)

export function LeaderboardTable({ rows, viewerId }: { rows: BoardRow[]; viewerId: string }) {
  if (rows.length === 0) {
    return <p className="ts-placeholder mt-3">No ranked trades in this window yet — log public trades to climb.</p>
  }
  return (
    <div className="ts-card ts-board mt-4" style={{ padding: 8 }}>
      <table className="ts-table ts-board-table">
        <thead><tr><th>#</th><th>Trader</th><th>Metric</th><th>Win%</th><th>Avg R</th><th>Trades</th><th></th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.userId} data-self={row.userId === viewerId}>
              <td><span className={`ts-lb-num ts-lb-num--${row.rank <= 3 ? row.rank : 'x'}`}>{row.rank}</span></td>
              <td><UserLink username={row.username} displayName={row.displayName} avatarUrl={row.avatarUrl} /></td>
              <td>
                <div className="ts-board-metric"><span className="val">{row.headline}</span>
                  <span className="ts-board-bar"><i style={{ width: `${row.barPct}%` }} /></span>
                </div>
              </td>
              <td>{pct(row.winRate)}</td>
              <td>{r2(row.avgR)}</td>
              <td>{row.trades ?? '—'}</td>
              <td>{row.userId === viewerId ? <span className="faint">You</span> : <FollowButton targetId={row.userId} initialFollowing={false} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Create `Podium.tsx`**

```tsx
import type { BoardRow } from './LeaderboardTable'
import { FollowButton } from '@/app/_components/FollowButton'

// Visual order: #2 left, #1 center (elevated), #3 right.
const SLOTS = [1, 0, 2] // indexes into the top-3 array

export function Podium({ top, viewerId }: { top: BoardRow[]; viewerId: string }) {
  if (top.length === 0) return null
  return (
    <div className="ts-podium mt-4">
      {SLOTS.map((idx) => {
        const row = top[idx]
        if (!row) return <div key={idx} className="ts-pod ts-pod--empty" />
        return (
          <div key={row.userId} className={`ts-pod ts-pod--${row.rank}`} data-self={row.userId === viewerId}>
            <div className="ts-pod-rank">{row.rank === 1 ? '👑' : `#${row.rank}`}</div>
            <span className="ts-pod-av">
              {row.avatarUrl ? <img src={row.avatarUrl} alt="" /> : (row.displayName || row.username).charAt(0).toUpperCase()}
            </span>
            <div className="ts-pod-name">{row.displayName || row.username}</div>
            <div className="ts-pod-un">@{row.username}</div>
            <div className="ts-pod-metric">{row.headline}</div>
            <div className="ts-pod-stats">
              {row.winRate != null && <span>{Math.round(row.winRate * 100)}% win</span>}
              {row.avgR != null && <span>{row.avgR.toFixed(2)}R</span>}
              {row.trades != null && <span>{row.trades} trades</span>}
            </div>
            <div className="ts-pod-cta">
              {row.userId === viewerId
                ? <a href={`/app/${row.username}`} className="btn btn-band-ghost btn-sm">View</a>
                : <FollowButton targetId={row.userId} initialFollowing={false} />}
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 3: Create `RankCard.tsx`**

```tsx
export function RankCard({ rank, total }: { rank: number | null; total: number }) {
  const topPct = rank && total ? Math.max(1, Math.round((rank / total) * 100)) : null
  return (
    <div className="ts-totw ts-rankcard">
      <div className="ts-totw-glow" />
      <div className="ts-totw-body">
        <p className="eyebrow" style={{ color: 'rgba(255,255,255,0.85)' }}>Your rank · all-time</p>
        {rank
          ? <><div className="ts-rankcard-rank">#{rank}</div><div className="ts-rankcard-sub">top {topPct}% of {total} traders</div></>
          : <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 8 }}>Log public closed trades to earn a rank.</p>}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/leaderboard/_components/
git commit -m "feat(app): leaderboard podium, table, rank card components"
```

---

## Task 4: URL-driven tabs + controls

**Files:**
- Create: `app/src/app/leaderboard/_components/LeaderboardTabs.tsx`
- Create: `app/src/app/leaderboard/_components/LeaderboardControls.tsx`

Both are client components that push query params (`cat`, `period`, `sort`) and let the server `page.tsx` re-render.

- [ ] **Step 1: Create `LeaderboardTabs.tsx`**

```tsx
'use client'

import { useRouter, useSearchParams } from 'next/navigation'

const TABS = [
  { key: 'performance', label: 'Performance' },
  { key: 'consistency', label: 'Consistency' },
  { key: 'followed', label: 'Most Followed' },
] as const
const SOON = ['XP', 'Learning']

export function LeaderboardTabs({ active }: { active: string }) {
  const router = useRouter()
  const sp = useSearchParams()
  const go = (cat: string) => {
    const period = sp.get('period') ?? 'week'
    router.push(`/leaderboard?cat=${cat}&period=${period}`)
  }
  return (
    <div className="ts-lbtabs">
      {TABS.map((t) => (
        <button key={t.key} className="ts-lbtab" data-active={active === t.key} onClick={() => go(t.key)}>{t.label}</button>
      ))}
      {SOON.map((s) => (
        <span key={s} className="ts-lbtab ts-lbtab--soon" title={`${s} — coming soon`}>{s}<span className="ts-soon">soon</span></span>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Create `LeaderboardControls.tsx`**

```tsx
'use client'

import { useRouter, useSearchParams } from 'next/navigation'

const PERIODS = [
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'all', label: 'All-time' },
] as const
const SORTS = [
  { key: 'pnl', label: 'Total P&L' },
  { key: 'winRate', label: 'Win rate' },
  { key: 'avgR', label: 'Avg R:R' },
  { key: 'trades', label: 'Trades' },
] as const

export function LeaderboardControls({ cat, period, sort }: { cat: string; period: string; sort: string }) {
  const router = useRouter()
  const sp = useSearchParams()
  const push = (next: Record<string, string>) => {
    const p = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(next)) p.set(k, v)
    p.set('cat', cat)
    router.push(`/leaderboard?${p.toString()}`)
  }
  return (
    <div className="ts-lbcontrols">
      {cat !== 'followed' && (
        <div className="ts-seg">
          {PERIODS.map((p) => (
            <button key={p.key} className="ts-seg-btn" data-active={period === p.key} onClick={() => push({ period: p.key })}>{p.label}</button>
          ))}
        </div>
      )}
      {cat === 'performance' && (
        <label className="ts-lbsort">
          <span className="faint">Sort</span>
          <select className="ts-select" value={sort} onChange={(e) => push({ sort: e.target.value })}>
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Typecheck & commit**

Run: `cd app && npx tsc --noEmit` (Expected: no errors)

```bash
git add app/src/app/leaderboard/_components/LeaderboardTabs.tsx app/src/app/leaderboard/_components/LeaderboardControls.tsx
git commit -m "feat(app): leaderboard tabs + period/sort controls"
```

---

## Task 5: Leaderboard page (server component)

**Files:**
- Create: `app/src/app/leaderboard/page.tsx`

Reads `searchParams`, requires auth (matches `app/src/app/page.tsx`), builds `BoardRow[]` per category, computes the viewer's all-time rank, renders tabs/controls/podium/table/rank-card.

- [ ] **Step 1: Create `page.tsx`**

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPerformanceRanking } from '@/lib/server/ranking'
import { rankConsistency, rankFollowers, type Period, type PerfSort } from '@/lib/leaderboard'
import { LeaderboardTabs } from './_components/LeaderboardTabs'
import { LeaderboardControls } from './_components/LeaderboardControls'
import { Podium } from './_components/Podium'
import { LeaderboardTable, type BoardRow } from './_components/LeaderboardTable'
import { RankCard } from './_components/RankCard'

const fmtPnl = (n: number) => `${n >= 0 ? '+' : '−'}$${Math.abs(n).toFixed(0)}`
const maxAbs = (xs: number[]) => Math.max(1, ...xs.map((x) => Math.abs(x)))

type Search = { cat?: string; period?: string; sort?: string }

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams
  const cat = (['performance', 'consistency', 'followed'].includes(sp.cat ?? '') ? sp.cat : 'performance') as string
  const period = (['week', 'month', 'all'].includes(sp.period ?? '') ? sp.period : 'week') as Period
  const sort = (['pnl', 'winRate', 'avgR', 'trades'].includes(sp.sort ?? '') ? sp.sort : 'pnl') as PerfSort

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Viewer's all-time rank (rank card + reused mental model).
  const allTime = await getPerformanceRanking(supabase, 'all')
  const viewerRank = allTime.find((e) => e.userId === user.id)?.rank ?? null

  let rows: BoardRow[] = []
  if (cat === 'performance') {
    const entries = await getPerformanceRanking(supabase, period, sort)
    const cap = maxAbs(entries.map((e) => e.pnl))
    rows = entries.map((e) => ({
      rank: e.rank, userId: e.userId, username: e.username, displayName: e.displayName, avatarUrl: e.avatarUrl,
      headline: fmtPnl(e.pnl), barPct: Math.round((Math.abs(e.pnl) / cap) * 100),
      winRate: e.winRate, avgR: e.avgR, trades: e.trades,
    }))
  } else if (cat === 'consistency') {
    // Re-rank by raw logged-trade volume (public closed only, same window).
    const { windowStart } = await import('@/lib/leaderboard')
    const cutoff = windowStart(period, Date.now())
    let q = supabase.from('trades').select('user_id, traded_at').eq('is_public', true).eq('status', 'closed')
    if (cutoff) q = q.gte('traded_at', cutoff)
    const { data: trs } = await q
    const ranked = rankConsistency((trs ?? []) as { user_id: string }[])
    rows = await joinProfiles(supabase, ranked, (r) => `${r.count} trades`, ranked[0]?.count ?? 1)
  } else {
    const { data: follows } = await supabase.from('follows').select('following_id')
    const ranked = rankFollowers((follows ?? []) as { following_id: string }[])
      .map((r) => ({ ...r, user_id: r.userId }))
    rows = await joinProfiles(supabase, ranked, (r) => `${r.count} followers`, ranked[0]?.count ?? 1)
  }

  const top3 = rows.slice(0, 3)

  return (
    <main className="ts-page ts-feed">
      <div className="ts-feed-main">
        <header className="ts-lbhead">
          <h1 className="ts-h1">Leaderboard</h1>
          <p className="muted">Top traders ranked by performance, consistency, and following — updated live.</p>
        </header>
        <LeaderboardTabs active={cat} />
        <LeaderboardControls cat={cat} period={period} sort={sort} />
        <Podium top={top3} viewerId={user.id} />
        <LeaderboardTable rows={rows} viewerId={user.id} />
      </div>
      <aside className="ts-feed-side">
        <RankCard rank={viewerRank} total={allTime.length} />
        <div className="ts-card ts-railcard">
          <div className="ts-rail-head"><h2 className="ts-h2">Daily quests</h2><span className="ts-soon">soon</span></div>
          <p className="faint mt-3" style={{ fontSize: 13 }}>Quests arrive with the XP phase.</p>
        </div>
        <div className="ts-card ts-railcard">
          <div className="ts-rail-head"><h2 className="ts-h2">Top movers</h2><span className="ts-soon">soon</span></div>
          <p className="faint mt-3" style={{ fontSize: 13 }}>Biggest weekly climbers, coming soon.</p>
        </div>
      </aside>
    </main>
  )
}

// Shared profile join for the count-based categories (consistency, followed).
async function joinProfiles(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ranked: { userId: string; count: number; rank: number }[],
  headline: (r: { userId: string; count: number; rank: number }) => string,
  cap: number,
): Promise<BoardRow[]> {
  if (ranked.length === 0) return []
  const { data: profs } = await supabase
    .from('profiles').select('id, username, display_name, avatar_url')
    .in('id', ranked.map((r) => r.userId)).eq('is_public', true).eq('onboarding_completed', true)
  const pmap = new Map((profs ?? []).map((p) => [p.id, p]))
  return ranked
    .filter((r) => pmap.has(r.userId))
    .map((r) => {
      const p = pmap.get(r.userId)!
      return {
        rank: r.rank, userId: r.userId, username: p.username, displayName: p.display_name, avatarUrl: p.avatar_url,
        headline: headline(r), barPct: Math.round((r.count / Math.max(1, cap)) * 100),
        winRate: null, avgR: null, trades: r.count,
      }
    })
}
```

> Note: filtering by profile happens after `rankConsistency`/`rankFollowers`, so the count categories can show small rank gaps when a private profile is dropped. That's acceptable per spec (Performance is the canonical ranking and is gap-free via Task 2). Keep it simple here.

- [ ] **Step 2: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Smoke-test in the dev server**

Run (in a separate terminal, leave running): `cd app && npm run dev`
Then load `http://localhost:3000/app/leaderboard` while logged in.
Expected: header, tabs, controls render; empty state shows if no public closed trades exist yet. (Never run `npm run build` while the dev server is up.)

- [ ] **Step 4: Commit**

```bash
git add app/src/app/leaderboard/page.tsx
git commit -m "feat(app): /leaderboard page (podium, table, rank card, categories)"
```

---

## Task 6: Leaderboard CSS

**Files:**
- Modify: `app/src/app/globals.css` (append a leaderboard block at end of file)

Reuses existing tokens/classes; adds only podium, board-table, tabs, controls, rank-card styles.

- [ ] **Step 1: Append styles**

Add to the end of `app/src/app/globals.css`:

```css
/* ---- Leaderboard (Phase 4) ---- */
.ts-lbhead { margin-bottom: 4px; }
.ts-lbtabs { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; }
.ts-lbtab { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 999px;
  border: 1px solid var(--line, rgba(255,255,255,0.08)); background: transparent; color: var(--dim, #b6b2c2);
  font-weight: 600; font-size: 14px; cursor: pointer; }
.ts-lbtab[data-active="true"] { background: var(--brand, #7C5CE6); color: #fff; border-color: transparent; }
.ts-lbtab--soon { cursor: default; opacity: 0.6; }

.ts-lbcontrols { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 14px; flex-wrap: wrap; }
.ts-seg { display: inline-flex; background: rgba(255,255,255,0.04); border-radius: 10px; padding: 3px; }
.ts-seg-btn { padding: 6px 12px; border-radius: 8px; border: none; background: transparent; color: var(--dim, #b6b2c2);
  font-weight: 600; font-size: 13px; cursor: pointer; }
.ts-seg-btn[data-active="true"] { background: rgba(255,255,255,0.10); color: #fff; }
.ts-lbsort { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; }

.ts-podium { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; align-items: end; }
.ts-pod { background: var(--card, #16131f); border: 1px solid var(--line, rgba(255,255,255,0.08)); border-radius: 16px;
  padding: 16px 12px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.ts-pod--1 { transform: translateY(-12px); border-color: rgba(255,196,84,0.5); box-shadow: 0 8px 30px rgba(255,196,84,0.12); }
.ts-pod--empty { background: transparent; border: 1px dashed var(--line, rgba(255,255,255,0.08)); }
.ts-pod-rank { font-size: 20px; }
.ts-pod-av { width: 56px; height: 56px; border-radius: 50%; display: grid; place-items: center; overflow: hidden;
  background: rgba(124,92,230,0.25); font-weight: 700; }
.ts-pod-av img { width: 100%; height: 100%; object-fit: cover; }
.ts-pod-name { font-weight: 700; }
.ts-pod-un { color: var(--dim, #b6b2c2); font-size: 12px; }
.ts-pod-metric { font-weight: 800; font-size: 18px; margin-top: 2px; }
.ts-pod-stats { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; color: var(--dim, #b6b2c2); font-size: 12px; }
.ts-pod-cta { margin-top: 8px; }
.ts-pod[data-self="true"] { outline: 2px solid var(--brand, #7C5CE6); }

.ts-board-table td, .ts-board-table th { vertical-align: middle; }
.ts-board-table tr[data-self="true"] { background: rgba(124,92,230,0.10); }
.ts-board-metric { display: flex; flex-direction: column; gap: 4px; min-width: 90px; }
.ts-board-metric .val { font-weight: 700; }
.ts-board-bar { display: block; height: 4px; border-radius: 2px; background: rgba(255,255,255,0.08); }
.ts-board-bar i { display: block; height: 100%; border-radius: 2px; background: var(--brand, #7C5CE6); }

.ts-rankcard-rank { font-size: 34px; font-weight: 800; color: #fff; line-height: 1.1; margin-top: 6px; }
.ts-rankcard-sub { color: rgba(255,255,255,0.85); font-size: 13px; }

@media (max-width: 640px) { .ts-podium { grid-template-columns: 1fr; } .ts-pod--1 { transform: none; } }
```

> If `--line`/`--card`/`--brand`/`--dim` are already defined in `:root`, the fallbacks are inert. Verify the variable names with `grep -nE '\--(brand|card|line|dim):' app/src/app/globals.css` and adjust the property names if they differ; do not introduce new color literals where a token exists.

- [ ] **Step 2: Visually verify**

Reload `http://localhost:3000/app/leaderboard`. Podium sits above the table; #1 is elevated/center; the segmented period control and sort dropdown render.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/globals.css
git commit -m "style(app): leaderboard podium, table, tabs, rank card"
```

---

## Task 7: Nav link → real route

**Files:**
- Modify: `app/src/app/_components/NavLinks.tsx:12`

- [ ] **Step 1: Replace the soon span with a Link**

In `app/src/app/_components/NavLinks.tsx`, replace:

```tsx
      <span className="ts-navpill ts-navpill--soon" title="Leaderboard — coming soon">Leaderboard</span>
```

with:

```tsx
      <Link href="/leaderboard" className="ts-navpill" data-active={!!path?.startsWith('/leaderboard')}>Leaderboard</Link>
```

- [ ] **Step 2: Verify & commit**

Reload the app; the nav "Leaderboard" pill is now an active link to `/app/leaderboard`.

```bash
git add app/src/app/_components/NavLinks.tsx
git commit -m "feat(app): nav Leaderboard is a real link"
```

---

## Task 8: Wire home RightRail + WelcomeHero to real data

**Files:**
- Modify: `app/src/app/feed/_components/RightRail.tsx`
- Modify: `app/src/app/feed/_components/WelcomeHero.tsx`
- Modify: `app/src/app/page.tsx`

- [ ] **Step 1: Add a `leaders` prop to `RightRail` and render real P&L**

In `app/src/app/feed/_components/RightRail.tsx`, add to the top types:

```tsx
type Leader = { rank: number; username: string; display_name: string | null; avatar_url: string | null; pnl: number }
```

Change the component signature:

```tsx
export function RightRail({ suggested, recentTrades, leaders }: { suggested: Trader[]; recentTrades: RecentTrade[]; leaders: Leader[] }) {
  const featured = suggested[0]
```

(Delete the old `const board = suggested.slice(0, 5)` line.)

Replace the entire `{/* Leaderboard */}` card block with:

```tsx
      {/* Leaderboard (real, this week) */}
      <div className="ts-card ts-railcard">
        <div className="ts-rail-head"><h2 className="ts-h2">Leaderboard · this week</h2><a href="/app/leaderboard" className="ts-link-sm">All</a></div>
        <div className="ts-lb mt-3">
          {leaders.length === 0
            ? <p className="faint" style={{ fontSize: 13 }}>Rankings populate as traders log public results.</p>
            : leaders.map((t) => (
                <div key={t.username} className="ts-lb-row">
                  <span className={`ts-lb-num ts-lb-num--${t.rank <= 3 ? t.rank : 'x'}`}>{t.rank}</span>
                  <UserLink username={t.username} displayName={t.display_name} avatarUrl={t.avatar_url} />
                  <span className={`ts-lb-val ${t.pnl >= 0 ? 'ts-pos' : 'ts-neg'}`} style={{ fontWeight: 700 }}>
                    {t.pnl >= 0 ? '+' : '−'}${Math.abs(t.pnl).toFixed(0)}
                  </span>
                </div>
              ))}
        </div>
      </div>
```

- [ ] **Step 2: Wire `WelcomeHero` standing rank + real race**

In `app/src/app/feed/_components/WelcomeHero.tsx`, change the type + signature:

```tsx
type Leader = { rank: number; username: string; display_name: string | null; avatar_url: string | null; pnl: number }

export function WelcomeHero({ name, streak, rank, total, race }: { name: string; streak: number; rank: number | null; total: number; race: Leader[] }) {
```

Replace the `eyebrow` + `ts-standing-top` block:

```tsx
        <p className="eyebrow">Your standing</p>
        <div className="ts-standing-top">
          <span className="ts-standing-rank grad-text">{rank ? `#${rank}` : '#—'}</span>
          <div className="ts-standing-chips">
            <span className="ts-chip2">🏆 {rank ? `top ${Math.max(1, Math.round((rank / Math.max(1, total)) * 100))}%` : 'Unranked'}</span>
            {streak !== 0 && (
              <span className={`ts-chip2 ${streak > 0 ? 'ts-chip2--up' : 'ts-chip2--down'}`}>
                {Math.abs(streak)}-trade {streak > 0 ? 'win' : 'loss'} streak
              </span>
            )}
          </div>
        </div>
```

Update the standing copy line (remove "coming soon" framing):

```tsx
        <p className="ts-standing-text">
          Welcome back, <b>{name}</b>. Log public setups to climb the <a href="/app/leaderboard" className="ts-link-sm">leaderboard</a>.
        </p>
```

Replace the race card's `eyebrow`/`soon` header and the race list:

```tsx
      <div className="ts-card ts-race">
        <div className="flex items-center justify-between">
          <p className="eyebrow">The race · this week</p>
          <a href="/app/leaderboard" className="ts-link-sm">All</a>
        </div>
        <div className="ts-race-list mt-3">
          {race.length === 0
            ? <p className="faint" style={{ fontSize: 13 }}>Log public trades to enter the race.</p>
            : race.map((t) => (
                <div key={t.username} className="ts-race-row">
                  <span className="ts-race-num">{t.rank}</span>
                  <UserLink username={t.username} displayName={t.display_name} avatarUrl={t.avatar_url} />
                  <span className={`ts-lb-val ${t.pnl >= 0 ? 'ts-pos' : 'ts-neg'}`} style={{ marginLeft: 'auto', fontWeight: 700 }}>
                    {t.pnl >= 0 ? '+' : '−'}${Math.abs(t.pnl).toFixed(0)}
                  </span>
                </div>
              ))}
        </div>
      </div>
```

- [ ] **Step 3: Feed home page passes real rankings**

In `app/src/app/page.tsx`, add the import near the top:

```tsx
import { getPerformanceRanking } from '@/lib/server/ranking'
```

After `const name = profile?.display_name || ...` (the profile block), add:

```tsx
  // Leaderboard data (shared helper): week board for rail/race, all-time for the viewer's rank.
  const [weekBoard, allTimeBoard] = await Promise.all([
    getPerformanceRanking(supabase, 'week'),
    getPerformanceRanking(supabase, 'all'),
  ])
  const viewerRank = allTimeBoard.find((e) => e.userId === user.id)?.rank ?? null
  const leaders = weekBoard.slice(0, 5).map((e) => ({ rank: e.rank, username: e.username, display_name: e.displayName, avatar_url: e.avatarUrl, pnl: e.pnl }))
```

Change the `WelcomeHero` and `RightRail` JSX:

```tsx
        <WelcomeHero name={name} streak={metrics.currentStreak} rank={viewerRank} total={allTimeBoard.length} race={leaders.slice(0, 3)} />
```

```tsx
      <RightRail suggested={suggested} recentTrades={recentTrades} leaders={leaders} />
```

- [ ] **Step 4: Typecheck & smoke-test**

Run: `cd app && npx tsc --noEmit` (Expected: no errors)
Reload `http://localhost:3000/app` while logged in — the right-rail leaderboard, the race, and the standing rank now reflect real public trades (or show the new empty states).

- [ ] **Step 5: Commit**

```bash
git add app/src/app/feed/_components/RightRail.tsx app/src/app/feed/_components/WelcomeHero.tsx app/src/app/page.tsx
git commit -m "feat(app): wire home rail, race, and standing rank to leaderboard data"
```

---

## Task 9: Real rank on the profile page

**Files:**
- Modify: `app/src/app/[username]/page.tsx`

- [ ] **Step 1: Compute the profile's all-time rank**

In `app/src/app/[username]/page.tsx`, add the import:

```tsx
import { getPerformanceRanking } from '@/lib/server/ranking'
```

After `const profileId = idRow?.id` is known and the trades have been fetched (anywhere before the `return`), add:

```tsx
  let profileRank: number | null = null
  if (profileId) {
    const board = await getPerformanceRanking(supabase, 'all')
    profileRank = board.find((e) => e.userId === profileId)?.rank ?? null
  }
```

In the `ts-statgrid`, replace the Experience stat cell line:

```tsx
          <div className="ts-stat"><dt>Experience</dt><dd>{profile.experience_level ?? '—'}</dd></div>
```

with both an Experience and a Rank cell:

```tsx
          <div className="ts-stat"><dt>Experience</dt><dd>{profile.experience_level ?? '—'}</dd></div>
          <div className="ts-stat"><dt>Rank</dt><dd>{profileRank ? `#${profileRank}` : 'Unranked'}</dd></div>
```

- [ ] **Step 2: Typecheck & smoke-test**

Run: `cd app && npx tsc --noEmit` (Expected: no errors)
Visit `http://localhost:3000/app/<some-username>` — the Rank cell shows `#N` for a trader with public closed trades, else "Unranked".

- [ ] **Step 3: Commit**

```bash
git add "app/src/app/[username]/page.tsx"
git commit -m "feat(app): real all-time rank on profile page"
```

---

## Task 10: Playwright e2e

**Files:**
- Create: `app/tests/e2e/leaderboard.spec.ts`

Two users each set an account balance (so `pnl_amount` computes) and log a public winning trade with different balances → different P&L → deterministic order. Verifies both appear, order, the nav link, and a period switch.

- [ ] **Step 1: Ensure the dev server is running warm**

Run (separate terminal): `cd app && npm run dev` and load `/app` once so routes are compiled (cold compile can exceed Playwright's default timeouts).

- [ ] **Step 2: Write the spec**

Create `app/tests/e2e/leaderboard.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test'

async function signUpAndOnboard(page: Page, prefix: string) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000)
  const username = `${prefix}_${stamp}`
  await page.goto('/app/signup')
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="email"]', `${username}@tradingsocial.io`)
  await page.fill('input[name="password"]', 'password123')
  await page.check('input[name="terms"]')
  await page.click('button:has-text("Join the Beta")')
  await expect(page).toHaveURL(/\/app\/onboarding/)
  await page.locator('label.ts-chip', { hasText: 'forex' }).click()
  await page.fill('input[name="goal"]', 'Be consistent')
  await page.click('button:has-text("Finish")')
  await expect(page).toHaveURL(/\/app$/)
  return username
}

async function logout(page: Page) {
  await page.goto('/app/settings')
  await page.click('button:has-text("Log out")')
  await expect(page).toHaveURL(/\/app\/login/)
}

// Sets the account balance (so money P&L computes) then logs one public winning trade
// risking `riskPercent`. With the same +R outcome, a larger balance => larger P&L.
async function setupAndLogWin(page: Page, balance: string) {
  await page.goto('/app/settings')
  await page.fill('input[name="account_balance"]', balance)
  await page.click('button:has-text("Save account")')

  await page.goto('/app/journal')
  await page.locator('button:has-text("Log trade")').first().click()
  await page.fill('input[name="risk_percent"]', '1')
  await page.fill('input[name="entry_price"]', '1.0856')
  await page.fill('input[name="stop_price"]', '1.0806')
  await page.fill('input[name="target_price"]', '1.0936')
  await page.fill('input[name="exit_price"]', '1.0936') // closes as a win
  // is_public defaults to "public" — leave it.
  await page.click('button:has-text("Save trade")')
  await expect(page.locator('table.ts-table')).toContainText('EUR/USD')
}

test('two traders ranked by P&L on the leaderboard', async ({ page }) => {
  const userHigh = await signUpAndOnboard(page, 'lb_hi')
  await setupAndLogWin(page, '10000') // bigger balance -> bigger P&L
  await logout(page)

  const userLow = await signUpAndOnboard(page, 'lb_lo')
  await setupAndLogWin(page, '2000')  // smaller balance -> smaller P&L

  await page.goto('/app/leaderboard')
  const board = page.locator('.ts-board-table tbody')
  await expect(board).toContainText(userHigh)
  await expect(board).toContainText(userLow)

  // Higher P&L ranks above: userHigh's row precedes userLow's row.
  const rowsText = await board.locator('tr').allInnerTexts()
  const hiIdx = rowsText.findIndex((r) => r.includes(userHigh))
  const loIdx = rowsText.findIndex((r) => r.includes(userLow))
  expect(hiIdx).toBeGreaterThanOrEqual(0)
  expect(loIdx).toBeGreaterThan(hiIdx)

  // Period switch still renders the board.
  await page.click('.ts-seg-btn:has-text("All-time")')
  await expect(page.locator('.ts-board-table tbody')).toContainText(userLow)
})

test('nav Leaderboard link opens the page', async ({ page }) => {
  await signUpAndOnboard(page, 'lb_nav')
  await page.click('.ts-navpills a:has-text("Leaderboard")')
  await expect(page).toHaveURL(/\/app\/leaderboard/)
  await expect(page.locator('h1.ts-h1')).toContainText('Leaderboard')
})
```

- [ ] **Step 3: Run the e2e suite**

Run: `cd app && npm run test:e2e -- leaderboard`
Expected: both tests PASS. If the first run times out on a cold route, reload `/app/leaderboard` in a browser once and re-run (warm-compile note in memory).

- [ ] **Step 4: Run the full unit suite to confirm no regressions**

Run: `cd app && npm test`
Expected: all suites PASS.

- [ ] **Step 5: Commit**

```bash
git add app/tests/e2e/leaderboard.spec.ts
git commit -m "test(app): e2e leaderboard ranking, period switch, nav link"
```

---

## Self-Review (done while writing)

**Spec coverage:**
- §2 pure functions → Task 1 (all five, unit-tested). ✅
- §3 data flow / shared helper → Task 2 (`getPerformanceRanking`, aggregate-before-join for gap-free ranks) + Task 5 (count categories). ✅
- §4 UI (header, tabs, controls, podium, table, rank card, empty state) → Tasks 3–6. ✅
- §4 nav link → Task 7. ✅
- §5 wire RightRail + WelcomeHero race + profile rank → Tasks 8–9. (Also wired the home standing rank, free from the same all-time board.) ✅
- §7 tests → Task 1 (Vitest) + Task 10 (Playwright). ✅

**Placeholder scan:** every code step has full code; no TBD/TODO. ✅

**Type consistency:** `BoardRow` defined once in `LeaderboardTable.tsx`, imported by `Podium` and `page`. `RankedEntry` from `ranking.ts` used by page/feed/profile. `Period`/`PerfSort`/`PerfTrade`/`Agg` all from `leaderboard.ts`. `getPerformanceRanking(supabase, period, sort='pnl')` signature matches every call site (Task 5/8/9). ✅

**Known acceptable simplification:** count-category ranks (consistency/followed) may show small gaps if a private profile is filtered post-rank; Performance (the canonical board, rank card, profile, race) is gap-free. Documented inline in Task 5.
