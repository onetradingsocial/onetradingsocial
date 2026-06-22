# XP, Quests & Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a derived (no-migration) trade-centric gamification layer — XP, rising-cost levels, daily/weekly quests, milestone badges — plus a windowed XP leaderboard tab and a dedicated `/app/achievements` page.

**Architecture:** All XP/level/quest/badge state is a **pure function of the `trades` table + clock**, mirroring `lib/leaderboard.ts` + `lib/server/ranking.ts`. Pure logic in `lib/xp.ts` (unit-tested); server aggregation in `lib/server/xp.ts`. No new tables, no write hooks; backfill and windowing fall out for free. The static `profiles.xp`/`profiles.level` columns (migration 0001) are intentionally **not read** — derived value is the single source of truth.

**Tech Stack:** Next.js App Router (TS, `basePath:/app`), Supabase (`@supabase/ssr`), vitest (unit), Playwright (e2e), Tailwind + existing `ts-*`/`lb-*` CSS.

**Spec:** `docs/superpowers/specs/2026-06-22-xp-quests-badges-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `app/src/lib/xp.ts` (create) | Pure XP logic: constants, level curve, quest defs/progress, historical bonuses, totals, windowXp, streaks, badges. |
| `app/tests/unit/xp.test.ts` (create) | Unit tests for every pure function (injected `now`). |
| `app/src/lib/server/xp.ts` (create) | `getUserXp` (one user) + `getXpRanking` (windowed board), clones of `ranking.ts`. |
| `app/src/app/achievements/page.tsx` (create) | Server route: XP hero, quests, badge grid. |
| `app/src/app/achievements/_components/XpHero.tsx` (create) | Level badge + XP progress bar + quest-streak. |
| `app/src/app/achievements/_components/QuestList.tsx` (create) | Daily/weekly quest rows with progress. |
| `app/src/app/achievements/_components/BadgeGrid.tsx` (create) | Badge grid grouped by category. |
| `app/src/app/feed/_components/DailyQuests.tsx` (create) | Compact home daily-quests widget → links to achievements. |
| `app/src/app/feed/_components/WelcomeHero.tsx` (modify) | Add level/XP chip + accept `level`/`xp` props. |
| `app/src/app/page.tsx` (modify) | Fetch `getUserXp`; render `DailyQuests`; pass level/xp to hero. |
| `app/src/app/leaderboard/_components/LeaderboardTabs.tsx` (create) | `Performance \| XP` category tab control. |
| `app/src/app/leaderboard/_components/XpTable.tsx` (create) | XP board table (Rank, Trader, Level, XP). |
| `app/src/app/leaderboard/page.tsx` (modify) | `?cat` routing; render XP board on `cat=xp`; real "Your XP" rail. |
| `app/src/app/leaderboard/_components/LeaderboardControls.tsx` (modify) | Hide `day` seg + `sort` select when `cat=xp`. |
| `app/src/app/[username]/page.tsx` (modify) | Derived Level/XP stat + earned-badge showcase. |
| `app/src/app/globals.css` (modify) | `.ach-*` / `.badge-*` / quest styles. |
| `app/tests/e2e/xp.spec.ts` (create) | Achievements renders; leaderboard XP tab populates. |

---

## Task 1: Level curve (`lib/xp.ts` foundation)

**Files:**
- Create: `app/src/lib/xp.ts`
- Test: `app/tests/unit/xp.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/tests/unit/xp.test.ts
import { describe, it, expect } from 'vitest'
import { XP, xpForLevel, levelFromXp } from '@/lib/xp'

describe('xpForLevel', () => {
  it('cumulative rising cost: reach(L) = 100*(L-1)*L/2', () => {
    expect(xpForLevel(1)).toBe(0)
    expect(xpForLevel(2)).toBe(100)
    expect(xpForLevel(3)).toBe(300)
    expect(xpForLevel(5)).toBe(1000)
    expect(xpForLevel(10)).toBe(4500)
    expect(xpForLevel(25)).toBe(30000)
  })
})

describe('levelFromXp', () => {
  it('returns level 1 at 0 XP with progress toward L2', () => {
    expect(levelFromXp(0)).toEqual({ level: 1, xpIntoLevel: 0, xpToNext: 100, progress: 0 })
  })
  it('crosses to next level exactly at the threshold', () => {
    expect(levelFromXp(100).level).toBe(2)
    expect(levelFromXp(99).level).toBe(1)
    expect(levelFromXp(1000).level).toBe(5)
  })
  it('reports progress fraction within the current level', () => {
    const r = levelFromXp(150) // L2 base 100, next 300, span 200, into 50
    expect(r).toEqual({ level: 2, xpIntoLevel: 50, xpToNext: 200, progress: 0.25 })
  })
  it('clamps negatives to level 1', () => {
    expect(levelFromXp(-10).level).toBe(1)
  })
  it('exposes tunable constants', () => {
    expect(XP.BASE_PER_TRADE).toBe(50)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- xp.test.ts`
Expected: FAIL — cannot resolve `@/lib/xp`.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/src/lib/xp.ts
export type Period = 'week' | 'month' | 'all'

export type XpTrade = {
  traded_at: string
  closed_at: string | null
  status: 'open' | 'closed'
  outcome: string
}

export const XP = {
  BASE_PER_TRADE: 50,
  DAILY_QUEST_BONUS: 30,
  WEEKLY_QUEST_BONUS: 150,
  LEVEL_BASE: 100,
} as const

// Cumulative XP required to REACH level L (L>=1). reach(1)=0, rising cost LEVEL_BASE*L per level.
export function xpForLevel(level: number): number {
  const L = Math.max(1, Math.floor(level))
  return (XP.LEVEL_BASE * (L - 1) * L) / 2
}

export type LevelInfo = { level: number; xpIntoLevel: number; xpToNext: number; progress: number }

export function levelFromXp(totalXp: number): LevelInfo {
  const xp = Math.max(0, totalXp)
  let level = 1
  while (xpForLevel(level + 1) <= xp) level += 1
  const base = xpForLevel(level)
  const next = xpForLevel(level + 1)
  const xpToNext = next - base
  const xpIntoLevel = xp - base
  return { level, xpIntoLevel, xpToNext, progress: xpToNext ? xpIntoLevel / xpToNext : 0 }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npm test -- xp.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/xp.ts app/tests/unit/xp.test.ts
git commit -m "feat(app): XP level curve (rising cost) + levelFromXp"
```

---

## Task 2: UTC boundaries, quest defs & quest progress

**Files:**
- Modify: `app/src/lib/xp.ts`
- Test: `app/tests/unit/xp.test.ts`

- [ ] **Step 1: Write the failing test (append to xp.test.ts)**

```ts
import {
  DAILY_QUESTS, WEEKLY_QUESTS, utcDayStart, utcWeekStart, dayKey, weekKey,
  dailyQuestProgress, weeklyQuestProgress, type XpTrade,
} from '@/lib/xp'

// Trade helper: created at `t` (traded_at); closed at `c` with outcome `o`.
const mk = (t: string, c: string | null = null, o = 'win'): XpTrade =>
  ({ traded_at: t, closed_at: c, status: c ? 'closed' : 'open', outcome: o })

describe('UTC boundaries', () => {
  it('utcDayStart floors to 00:00:00Z', () => {
    expect(new Date(utcDayStart(Date.parse('2026-06-22T15:30:00Z'))).toISOString())
      .toBe('2026-06-22T00:00:00.000Z')
  })
  it('utcWeekStart floors to Monday 00:00Z (ISO week)', () => {
    // 2026-06-22 is a Monday
    expect(new Date(utcWeekStart(Date.parse('2026-06-24T10:00:00Z'))).toISOString())
      .toBe('2026-06-22T00:00:00.000Z')
    // Sunday belongs to the week that started the prior Monday
    expect(new Date(utcWeekStart(Date.parse('2026-06-21T10:00:00Z'))).toISOString())
      .toBe('2026-06-15T00:00:00.000Z')
  })
  it('dayKey/weekKey are stable UTC bucket labels', () => {
    expect(dayKey(Date.parse('2026-06-22T23:59:00Z'))).toBe('2026-06-22')
    expect(weekKey(Date.parse('2026-06-24T10:00:00Z'))).toBe('2026-06-22')
  })
})

describe('quest progress (current window)', () => {
  const now = Date.parse('2026-06-22T12:00:00Z') // Monday
  it('daily: counts today created vs closed per quest', () => {
    const trades = [
      mk('2026-06-22T01:00:00Z', '2026-06-22T02:00:00Z'), // created + closed today
      mk('2026-06-21T23:00:00Z'),                          // yesterday -> ignored
    ]
    const d = dailyQuestProgress(trades, now)
    expect(d.find((q) => q.id === 'log_trade')).toMatchObject({ current: 1, target: 1, done: true })
    expect(d.find((q) => q.id === 'close_trade')).toMatchObject({ current: 1, target: 1, done: true })
  })
  it('weekly: counts this-week created/closed against targets', () => {
    const trades = Array.from({ length: 10 }, (_, i) =>
      mk(`2026-06-2${2 + (i % 5)}T0${i % 8}:00:00Z`.replace('2026-06-2', '2026-06-2'), null))
    const w = weeklyQuestProgress(trades, now)
    expect(w.find((q) => q.id === 'log_10')).toMatchObject({ current: 10, target: 10, done: true })
  })
  it('exposes quest definitions as data', () => {
    expect(DAILY_QUESTS.map((q) => q.id)).toEqual(['log_trade', 'close_trade'])
    expect(WEEKLY_QUESTS.map((q) => q.id)).toEqual(['log_10', 'close_5'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- xp.test.ts`
Expected: FAIL — `utcDayStart`/`DAILY_QUESTS` not exported.

- [ ] **Step 3: Write minimal implementation (append to lib/xp.ts)**

```ts
const DAY = 864e5

export type QuestMetric = 'created' | 'closed'
export type QuestDef = { id: string; label: string; target: number; metric: QuestMetric }

export const DAILY_QUESTS: QuestDef[] = [
  { id: 'log_trade', label: 'Log a trade today', target: 1, metric: 'created' },
  { id: 'close_trade', label: 'Close a trade today', target: 1, metric: 'closed' },
]
export const WEEKLY_QUESTS: QuestDef[] = [
  { id: 'log_10', label: 'Log 10 trades this week', target: 10, metric: 'created' },
  { id: 'close_5', label: 'Close 5 trades this week', target: 5, metric: 'closed' },
]

export function utcDayStart(now: number): number {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}
export function utcWeekStart(now: number): number {
  const ds = utcDayStart(now)
  const offset = (new Date(ds).getUTCDay() + 6) % 7 // days since Monday (Sun=0 -> 6)
  return ds - offset * DAY
}
export function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10) // YYYY-MM-DD (UTC)
}
export function weekKey(ms: number): string {
  return dayKey(utcWeekStart(ms)) // the Monday's day key labels the ISO week
}

// `created` -> traded_at; `closed` -> closed_at (only for closed trades).
function metricTime(t: XpTrade, metric: QuestMetric): number | null {
  if (metric === 'created') return Date.parse(t.traded_at)
  if (t.status === 'closed' && t.closed_at) return Date.parse(t.closed_at)
  return null
}
function countInBucket(trades: XpTrade[], metric: QuestMetric, start: number, end: number): number {
  let n = 0
  for (const t of trades) {
    const ts = metricTime(t, metric)
    if (ts != null && ts >= start && ts < end) n += 1
  }
  return n
}

export type QuestProgress = { id: string; label: string; target: number; current: number; done: boolean }

function progressFor(defs: QuestDef[], trades: XpTrade[], start: number, end: number): QuestProgress[] {
  return defs.map((q) => {
    const current = countInBucket(trades, q.metric, start, end)
    return { id: q.id, label: q.label, target: q.target, current, done: current >= q.target }
  })
}
export function dailyQuestProgress(trades: XpTrade[], now: number): QuestProgress[] {
  const start = utcDayStart(now)
  return progressFor(DAILY_QUESTS, trades, start, start + DAY)
}
export function weeklyQuestProgress(trades: XpTrade[], now: number): QuestProgress[] {
  const start = utcWeekStart(now)
  return progressFor(WEEKLY_QUESTS, trades, start, start + 7 * DAY)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npm test -- xp.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/xp.ts app/tests/unit/xp.test.ts
git commit -m "feat(app): UTC quest boundaries + daily/weekly quest progress"
```

---

## Task 3: Totals, historical bonuses & windowXp

**Files:**
- Modify: `app/src/lib/xp.ts`
- Test: `app/tests/unit/xp.test.ts`

- [ ] **Step 1: Write the failing test (append)**

```ts
import {
  closedCount, totalXpFromTrades, windowXp, windowCutoff,
  historicalDailyBonus, historicalWeeklyBonus,
} from '@/lib/xp'

describe('totals & bonuses', () => {
  it('totalXpFromTrades = trades*BASE + daily + weekly bonuses (one active day, no weekly target met)', () => {
    // 1 trade created+closed same day -> 1 closed (50) + 2 daily quests met (2*30) = 110
    const trades = [mk('2026-06-22T01:00:00Z', '2026-06-22T02:00:00Z')]
    expect(closedCount(trades)).toBe(1)
    expect(historicalDailyBonus(trades)).toBe(60)
    expect(historicalWeeklyBonus(trades)).toBe(0)
    expect(totalXpFromTrades(trades)).toBe(110)
  })
  it('weekly bonus triggers once 10 created in a week', () => {
    const trades = Array.from({ length: 10 }, (_, i) => mk(`2026-06-2${2}T0${i % 8}:0${i % 6}:00Z`, null))
    expect(historicalWeeklyBonus(trades)).toBe(150) // log_10 met once; close_5 not (none closed)
  })
})

describe('windowXp', () => {
  const now = Date.parse('2026-06-22T12:00:00Z')
  it('all-period equals total', () => {
    const trades = [mk('2026-06-22T01:00:00Z', '2026-06-22T02:00:00Z')]
    expect(windowXp(trades, 'all', now)).toBe(totalXpFromTrades(trades))
  })
  it('week window excludes trades closed before the cutoff', () => {
    const trades = [
      mk('2026-06-21T00:00:00Z', '2026-06-21T01:00:00Z'), // inside last 7d
      mk('2026-05-01T00:00:00Z', '2026-05-01T01:00:00Z'), // older -> excluded
    ]
    // 1 closed in window (50) + that day's 2 daily quests (60) = 110
    expect(windowXp(trades, 'week', now)).toBe(110)
  })
  it('windowCutoff: week=now-7d, month=now-30d, all=null', () => {
    expect(windowCutoff('all', now)).toBeNull()
    expect(windowCutoff('week', now)).toBe(now - 7 * 864e5)
    expect(windowCutoff('month', now)).toBe(now - 30 * 864e5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- xp.test.ts`
Expected: FAIL — `totalXpFromTrades` not exported.

- [ ] **Step 3: Write minimal implementation (append to lib/xp.ts)**

```ts
function bucketCounts(trades: XpTrade[], metric: QuestMetric, keyOf: (ms: number) => string): Map<string, number> {
  const m = new Map<string, number>()
  for (const t of trades) {
    const ts = metricTime(t, metric)
    if (ts == null) continue
    const k = keyOf(ts)
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return m
}

export function closedCount(trades: XpTrade[]): number {
  return trades.filter((t) => t.status === 'closed').length
}
export function historicalDailyBonus(trades: XpTrade[]): number {
  let bonus = 0
  for (const q of DAILY_QUESTS)
    for (const c of bucketCounts(trades, q.metric, dayKey).values())
      if (c >= q.target) bonus += XP.DAILY_QUEST_BONUS
  return bonus
}
export function historicalWeeklyBonus(trades: XpTrade[]): number {
  let bonus = 0
  for (const q of WEEKLY_QUESTS)
    for (const c of bucketCounts(trades, q.metric, weekKey).values())
      if (c >= q.target) bonus += XP.WEEKLY_QUEST_BONUS
  return bonus
}
export function totalXpFromTrades(trades: XpTrade[]): number {
  return XP.BASE_PER_TRADE * closedCount(trades) + historicalDailyBonus(trades) + historicalWeeklyBonus(trades)
}

export function windowCutoff(period: Period, now: number): number | null {
  if (period === 'all') return null
  return now - (period === 'week' ? 7 : 30) * DAY
}
// Sum of bucket-bonuses whose bucket START (UTC midnight) is >= cutoff.
function windowBonus(trades: XpTrade[], defs: QuestDef[], keyOf: (ms: number) => string, perBonus: number, cutoff: number): number {
  let bonus = 0
  for (const q of defs)
    for (const [k, c] of bucketCounts(trades, q.metric, keyOf))
      if (c >= q.target && Date.parse(k + 'T00:00:00.000Z') >= cutoff) bonus += perBonus
  return bonus
}
export function windowXp(trades: XpTrade[], period: Period, now: number): number {
  const cutoff = windowCutoff(period, now)
  if (cutoff == null) return totalXpFromTrades(trades)
  let base = 0
  for (const t of trades)
    if (t.status === 'closed' && t.closed_at && Date.parse(t.closed_at) >= cutoff) base += XP.BASE_PER_TRADE
  return base
    + windowBonus(trades, DAILY_QUESTS, dayKey, XP.DAILY_QUEST_BONUS, cutoff)
    + windowBonus(trades, WEEKLY_QUESTS, weekKey, XP.WEEKLY_QUEST_BONUS, cutoff)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npm test -- xp.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/xp.ts app/tests/unit/xp.test.ts
git commit -m "feat(app): XP totals, historical quest bonuses, windowXp"
```

---

## Task 4: Streaks & badges

**Files:**
- Modify: `app/src/lib/xp.ts`
- Test: `app/tests/unit/xp.test.ts`

- [ ] **Step 1: Write the failing test (append)**

```ts
import {
  questStreak, maxQuestStreak, winStreakMax, evaluateBadges, BADGES,
} from '@/lib/xp'

describe('streaks', () => {
  const now = Date.parse('2026-06-22T12:00:00Z')
  // Complete a daily quest set on a given UTC day = 1 created + 1 closed that day.
  const dayDone = (d: string): XpTrade[] => [mk(`${d}T01:00:00Z`, `${d}T02:00:00Z`)]
  it('questStreak counts consecutive complete days up to today', () => {
    const trades = [...dayDone('2026-06-22'), ...dayDone('2026-06-21'), ...dayDone('2026-06-20')]
    expect(questStreak(trades, now)).toBe(3)
  })
  it('today incomplete -> streak counts the run ending yesterday', () => {
    const trades = [...dayDone('2026-06-21'), ...dayDone('2026-06-20')]
    expect(questStreak(trades, now)).toBe(2)
  })
  it('a gap breaks the streak', () => {
    const trades = [...dayDone('2026-06-22'), ...dayDone('2026-06-20')] // missing 21st
    expect(questStreak(trades, now)).toBe(1)
  })
  it('maxQuestStreak finds the longest historical run', () => {
    const trades = [...dayDone('2026-06-01'), ...dayDone('2026-06-02'), ...dayDone('2026-06-22')]
    expect(maxQuestStreak(trades)).toBe(2)
  })
  it('winStreakMax = longest run of consecutive wins by close time', () => {
    const trades = [
      mk('2026-06-01T00:00:00Z', '2026-06-01T01:00:00Z', 'win'),
      mk('2026-06-02T00:00:00Z', '2026-06-02T01:00:00Z', 'win'),
      mk('2026-06-03T00:00:00Z', '2026-06-03T01:00:00Z', 'loss'),
      mk('2026-06-04T00:00:00Z', '2026-06-04T01:00:00Z', 'win'),
    ]
    expect(winStreakMax(trades)).toBe(2)
  })
})

describe('evaluateBadges', () => {
  it('marks earned vs locked with current progress', () => {
    const badges = evaluateBadges({ closedCount: 12, level: 3, maxQuestStreak: 7, maxWinStreak: 4 })
    expect(badges.find((b) => b.id === 'trades_10')).toMatchObject({ earned: true, current: 12 })
    expect(badges.find((b) => b.id === 'trades_50')).toMatchObject({ earned: false, current: 12 })
    expect(badges.find((b) => b.id === 'level_5')).toMatchObject({ earned: false, current: 3 })
    expect(badges.find((b) => b.id === 'streak_7')).toMatchObject({ earned: true, current: 7 })
    expect(badges.find((b) => b.id === 'wins_5')).toMatchObject({ earned: false, current: 4 })
  })
  it('declares all four badge categories', () => {
    expect(new Set(BADGES.map((b) => b.category)))
      .toEqual(new Set(['trades', 'level', 'questStreak', 'winStreak']))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- xp.test.ts`
Expected: FAIL — `questStreak` not exported.

- [ ] **Step 3: Write minimal implementation (append to lib/xp.ts)**

```ts
function dailyCountMaps(trades: XpTrade[]): Map<QuestMetric, Map<string, number>> {
  const per = new Map<QuestMetric, Map<string, number>>()
  for (const q of DAILY_QUESTS) if (!per.has(q.metric)) per.set(q.metric, bucketCounts(trades, q.metric, dayKey))
  return per
}
function dayComplete(per: Map<QuestMetric, Map<string, number>>, key: string): boolean {
  return DAILY_QUESTS.every((q) => (per.get(q.metric)!.get(key) ?? 0) >= q.target)
}

export function questStreak(trades: XpTrade[], now: number): number {
  const per = dailyCountMaps(trades)
  let cursor = utcDayStart(now)
  if (!dayComplete(per, dayKey(cursor))) cursor -= DAY // today not done -> count run ending yesterday
  let streak = 0
  while (dayComplete(per, dayKey(cursor))) { streak += 1; cursor -= DAY }
  return streak
}

export function maxQuestStreak(trades: XpTrade[]): number {
  const per = dailyCountMaps(trades)
  const keys = new Set<string>()
  for (const m of per.values()) for (const k of m.keys()) keys.add(k)
  const completeDays = [...keys].filter((k) => dayComplete(per, k))
    .map((k) => Date.parse(k + 'T00:00:00.000Z')).sort((a, b) => a - b)
  if (completeDays.length === 0) return 0
  let best = 1, run = 1
  for (let i = 1; i < completeDays.length; i++) {
    run = completeDays[i] - completeDays[i - 1] === DAY ? run + 1 : 1
    if (run > best) best = run
  }
  return best
}

export function winStreakMax(trades: XpTrade[]): number {
  const closed = trades.filter((t) => t.status === 'closed' && t.closed_at)
    .sort((a, b) => Date.parse(a.closed_at!) - Date.parse(b.closed_at!))
  let best = 0, run = 0
  for (const t of closed) {
    if (t.outcome === 'win') { run += 1; if (run > best) best = run } else run = 0
  }
  return best
}

export type BadgeCategory = 'trades' | 'level' | 'questStreak' | 'winStreak'
export type BadgeDef = { id: string; category: BadgeCategory; label: string; threshold: number }

export const BADGES: BadgeDef[] = [
  { id: 'trades_1', category: 'trades', label: 'First Trade', threshold: 1 },
  { id: 'trades_10', category: 'trades', label: '10 Trades', threshold: 10 },
  { id: 'trades_50', category: 'trades', label: '50 Trades', threshold: 50 },
  { id: 'trades_100', category: 'trades', label: '100 Trades', threshold: 100 },
  { id: 'trades_500', category: 'trades', label: '500 Trades', threshold: 500 },
  { id: 'level_5', category: 'level', label: 'Level 5', threshold: 5 },
  { id: 'level_10', category: 'level', label: 'Level 10', threshold: 10 },
  { id: 'level_25', category: 'level', label: 'Level 25', threshold: 25 },
  { id: 'streak_7', category: 'questStreak', label: '7-Day Streak', threshold: 7 },
  { id: 'streak_30', category: 'questStreak', label: '30-Day Streak', threshold: 30 },
  { id: 'wins_5', category: 'winStreak', label: '5 Win Streak', threshold: 5 },
  { id: 'wins_10', category: 'winStreak', label: '10 Win Streak', threshold: 10 },
]

export type BadgeStats = { closedCount: number; level: number; maxQuestStreak: number; maxWinStreak: number }
export type EvaluatedBadge = BadgeDef & { earned: boolean; current: number }

export function evaluateBadges(stats: BadgeStats): EvaluatedBadge[] {
  const value = (c: BadgeCategory): number =>
    c === 'trades' ? stats.closedCount
      : c === 'level' ? stats.level
      : c === 'questStreak' ? stats.maxQuestStreak
      : stats.maxWinStreak
  return BADGES.map((b) => {
    const current = value(b.category)
    return { ...b, current, earned: current >= b.threshold }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npm test -- xp.test.ts`
Expected: PASS (whole file).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/xp.ts app/tests/unit/xp.test.ts
git commit -m "feat(app): quest/win streaks + badge evaluation"
```

---

## Task 5: Server aggregation (`lib/server/xp.ts`)

**Files:**
- Create: `app/src/lib/server/xp.ts`

> No unit test (I/O wrapper, mirrors untested `lib/server/ranking.ts`); covered by e2e in Task 11.

- [ ] **Step 1: Write the module**

```ts
// app/src/lib/server/xp.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  type XpTrade, type Period, type QuestProgress, type EvaluatedBadge, type LevelInfo,
  totalXpFromTrades, levelFromXp, dailyQuestProgress, weeklyQuestProgress,
  questStreak, maxQuestStreak, winStreakMax, closedCount, evaluateBadges, windowXp,
} from '@/lib/xp'

export type UserXp = {
  totalXp: number
  level: LevelInfo
  daily: QuestProgress[]
  weekly: QuestProgress[]
  questStreak: number
  badges: EvaluatedBadge[]
}

// One user's full XP picture from ALL their trades (their own private view).
export async function getUserXp(supabase: SupabaseClient, userId: string, now = Date.now()): Promise<UserXp> {
  const { data } = await supabase
    .from('trades')
    .select('traded_at, closed_at, status, outcome')
    .eq('user_id', userId)
  const trades = (data ?? []) as XpTrade[]
  const totalXp = totalXpFromTrades(trades)
  const level = levelFromXp(totalXp)
  return {
    totalXp,
    level,
    daily: dailyQuestProgress(trades, now),
    weekly: weeklyQuestProgress(trades, now),
    questStreak: questStreak(trades, now),
    badges: evaluateBadges({
      closedCount: closedCount(trades),
      level: level.level,
      maxQuestStreak: maxQuestStreak(trades),
      maxWinStreak: winStreakMax(trades),
    }),
  }
}

export type XpRankedEntry = {
  rank: number; userId: string; username: string; displayName: string | null; avatarUrl: string | null
  xp: number; level: number
}

// Public closed trades -> per-user windowXp -> keep visible profiles -> rank by window XP.
// Level column reflects all-time PUBLIC XP (privacy-by-construction, same as performance board).
export async function getXpRanking(supabase: SupabaseClient, period: Period, now = Date.now()): Promise<XpRankedEntry[]> {
  const { data: rows } = await supabase
    .from('trades')
    .select('user_id, traded_at, closed_at, status, outcome')
    .eq('is_public', true)
    .eq('status', 'closed')

  const byUser = new Map<string, XpTrade[]>()
  for (const r of (rows ?? []) as (XpTrade & { user_id: string })[]) {
    const arr = byUser.get(r.user_id) ?? []
    arr.push(r)
    byUser.set(r.user_id, arr)
  }
  const scored = [...byUser.entries()]
    .map(([userId, trades]) => ({ userId, xp: windowXp(trades, period, now), level: levelFromXp(totalXpFromTrades(trades)).level }))
    .filter((s) => s.xp > 0)
  if (scored.length === 0) return []

  const { data: profs } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, created_at')
    .in('id', scored.map((s) => s.userId))
    .eq('is_public', true)
    .eq('onboarding_completed', true)
  const pmap = new Map((profs ?? []).map((p) => [p.id, p]))

  const visible = scored
    .filter((s) => pmap.has(s.userId))
    .map((s) => ({ ...s, joinedAt: Date.parse(pmap.get(s.userId)!.created_at) }))
    .sort((a, b) => b.xp - a.xp || a.joinedAt - b.joinedAt) // tie-break: earlier joiner ranks higher

  return visible.map((s, i) => {
    const p = pmap.get(s.userId)!
    return {
      rank: i + 1, userId: s.userId,
      username: p.username, displayName: p.display_name, avatarUrl: p.avatar_url,
      xp: s.xp, level: s.level,
    }
  })
}
```

- [ ] **Step 2: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/server/xp.ts
git commit -m "feat(app): server XP aggregation (getUserXp, getXpRanking)"
```

---

## Task 6: Achievements page + components

**Files:**
- Create: `app/src/app/achievements/page.tsx`, `app/src/app/achievements/_components/{XpHero,QuestList,BadgeGrid}.tsx`
- Modify: `app/src/app/globals.css`

- [ ] **Step 1: Create `XpHero.tsx`**

```tsx
// app/src/app/achievements/_components/XpHero.tsx
import type { LevelInfo } from '@/lib/xp'

export function XpHero({ level, totalXp, questStreak }: { level: LevelInfo; totalXp: number; questStreak: number }) {
  const pct = Math.round(level.progress * 100)
  return (
    <div className="ts-card ach-hero">
      <div className="ach-lvl">
        <span className="ach-lvl-badge grad-text">{level.level}</span>
        <div>
          <p className="eyebrow">Level {level.level}</p>
          <p className="ach-xp">{totalXp.toLocaleString()} XP total</p>
        </div>
        <span className="ts-chip2 ach-streak" style={{ marginLeft: 'auto' }}>🔥 {questStreak}-day quest streak</span>
      </div>
      <div className="ach-bar"><i style={{ width: pct + '%' }} /></div>
      <p className="faint" style={{ fontSize: 13 }}>{level.xpIntoLevel.toLocaleString()} / {level.xpToNext.toLocaleString()} XP to level {level.level + 1}</p>
    </div>
  )
}
```

- [ ] **Step 2: Create `QuestList.tsx`**

```tsx
// app/src/app/achievements/_components/QuestList.tsx
import type { QuestProgress } from '@/lib/xp'

export function QuestList({ title, quests, reward }: { title: string; quests: QuestProgress[]; reward: number }) {
  return (
    <div className="ts-card">
      <div className="ts-rail-head"><h2 className="ts-h2">{title}</h2><span className="faint" style={{ fontSize: 12 }}>+{reward} XP each</span></div>
      <ul className="ach-quests mt-3">
        {quests.map((q) => {
          const pct = Math.min(100, Math.round((q.current / q.target) * 100))
          return (
            <li key={q.id} className={'ach-quest' + (q.done ? ' done' : '')}>
              <span className="ach-quest-check" aria-hidden>{q.done ? '✓' : ''}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="ach-quest-top"><b>{q.label}</b><span className="faint">{q.current}/{q.target}</span></div>
                <div className="ach-qbar"><i style={{ width: pct + '%' }} /></div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
```

- [ ] **Step 3: Create `BadgeGrid.tsx`**

```tsx
// app/src/app/achievements/_components/BadgeGrid.tsx
import type { EvaluatedBadge, BadgeCategory } from '@/lib/xp'

const GROUPS: { category: BadgeCategory; title: string }[] = [
  { category: 'trades', title: 'Trade milestones' },
  { category: 'level', title: 'Level milestones' },
  { category: 'questStreak', title: 'Quest streaks' },
  { category: 'winStreak', title: 'Win streaks' },
]

export function BadgeGrid({ badges }: { badges: EvaluatedBadge[] }) {
  return (
    <div className="ts-card">
      <h2 className="ts-h2">Badges</h2>
      {GROUPS.map((g) => (
        <section key={g.category} className="mt-5">
          <p className="eyebrow">{g.title}</p>
          <div className="badge-grid mt-3">
            {badges.filter((b) => b.category === g.category).map((b) => (
              <div key={b.id} className={'badge' + (b.earned ? ' earned' : ' locked')}>
                <span className="badge-dot" aria-hidden>{b.earned ? '★' : '○'}</span>
                <b>{b.label}</b>
                {!b.earned && <span className="faint" style={{ fontSize: 11 }}>{b.current}/{b.threshold}</span>}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Create `page.tsx`**

```tsx
// app/src/app/achievements/page.tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserXp } from '@/lib/server/xp'
import { XP } from '@/lib/xp'
import { XpHero } from './_components/XpHero'
import { QuestList } from './_components/QuestList'
import { BadgeGrid } from './_components/BadgeGrid'

export default async function AchievementsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const xp = await getUserXp(supabase, user.id)

  return (
    <main className="ts-page" style={{ maxWidth: 820 }}>
      <header className="lb-head"><div className="tx">
        <h1 className="ts-h1">Achievements</h1>
        <p>Earn XP by logging and closing trades, complete daily &amp; weekly quests, and unlock milestone badges.</p>
      </div></header>

      <XpHero level={xp.level} totalXp={xp.totalXp} questStreak={xp.questStreak} />

      <div className="ach-quest-cols mt-6">
        <QuestList title="Daily quests" quests={xp.daily} reward={XP.DAILY_QUEST_BONUS} />
        <QuestList title="Weekly quests" quests={xp.weekly} reward={XP.WEEKLY_QUEST_BONUS} />
      </div>

      <div className="mt-6"><BadgeGrid badges={xp.badges} /></div>
    </main>
  )
}
```

- [ ] **Step 5: Append styles to `globals.css`**

```css
/* Achievements / XP */
.ach-hero { display: flex; flex-direction: column; gap: 12px; }
.ach-lvl { display: flex; align-items: center; gap: 14px; }
.ach-lvl-badge { font-size: 40px; font-weight: 800; line-height: 1; min-width: 52px; text-align: center; }
.ach-xp { font-weight: 700; }
.ach-bar, .ach-qbar { background: var(--line, rgba(255,255,255,.08)); border-radius: 999px; overflow: hidden; }
.ach-bar { height: 10px; } .ach-qbar { height: 6px; margin-top: 6px; }
.ach-bar i, .ach-qbar i { display: block; height: 100%; background: linear-gradient(90deg, #34d399, #22d3ee); }
.ach-quest-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 720px) { .ach-quest-cols { grid-template-columns: 1fr; } }
.ach-quests { list-style: none; display: flex; flex-direction: column; gap: 12px; }
.ach-quest { display: flex; align-items: center; gap: 10px; }
.ach-quest-top { display: flex; justify-content: space-between; gap: 8px; }
.ach-quest-check { width: 20px; height: 20px; border-radius: 999px; border: 1px solid var(--line, rgba(255,255,255,.18)); display: grid; place-items: center; font-size: 12px; color: #34d399; }
.ach-quest.done .ach-quest-check { background: rgba(52,211,153,.15); border-color: #34d399; }
.badge-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; }
.badge { display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center; padding: 14px 8px; border-radius: 12px; border: 1px solid var(--line, rgba(255,255,255,.08)); }
.badge.locked { opacity: .45; }
.badge.earned { background: rgba(52,211,153,.08); border-color: rgba(52,211,153,.35); }
.badge-dot { font-size: 22px; }
```

- [ ] **Step 6: Verify build/typecheck (dev server must NOT be running — per CLAUDE.md)**

Run: `cd app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add app/src/app/achievements app/src/app/globals.css
git commit -m "feat(app): /app/achievements page (XP hero, quests, badges)"
```

---

## Task 7: Home — daily quests widget + level chip

**Files:**
- Create: `app/src/app/feed/_components/DailyQuests.tsx`
- Modify: `app/src/app/feed/_components/WelcomeHero.tsx`, `app/src/app/page.tsx`

- [ ] **Step 1: Create `DailyQuests.tsx`**

```tsx
// app/src/app/feed/_components/DailyQuests.tsx
import type { QuestProgress } from '@/lib/xp'

export function DailyQuests({ quests }: { quests: QuestProgress[] }) {
  const done = quests.filter((q) => q.done).length
  return (
    <div className="ts-card">
      <div className="ts-rail-head">
        <h2 className="ts-h2">Daily quests</h2>
        <a href="/app/achievements" className="ts-link-sm">{done}/{quests.length} · All</a>
      </div>
      <ul className="ach-quests mt-3">
        {quests.map((q) => (
          <li key={q.id} className={'ach-quest' + (q.done ? ' done' : '')}>
            <span className="ach-quest-check" aria-hidden>{q.done ? '✓' : ''}</span>
            <div className="ach-quest-top" style={{ flex: 1 }}><b>{q.label}</b><span className="faint">{q.current}/{q.target}</span></div>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: Modify `WelcomeHero.tsx` — add level/xp props + chip**

Change the signature and the chips block:

```tsx
export function WelcomeHero({ name, streak, rank, total, race, level, xp }: { name: string; streak: number; rank: number | null; total: number; race: Leader[]; level: number; xp: number }) {
```

Then inside `<div className="ts-standing-chips">`, add as the FIRST chip (before the `🏆` chip):

```tsx
            <span className="ts-chip2">⚡ Lvl {level} · {xp.toLocaleString()} XP</span>
```

- [ ] **Step 3: Modify `page.tsx` — fetch XP, render widget, pass props**

Add import near the other server-lib imports (after line 14 `getPerformanceRanking`):

```tsx
import { getUserXp } from '@/lib/server/xp'
import { DailyQuests } from './feed/_components/DailyQuests'
```

Add the fetch alongside the existing leaderboard `Promise.all` (after line 37, the `leaders` definition):

```tsx
  const xp = await getUserXp(supabase, user.id)
```

Update the `WelcomeHero` usage (line 140) to pass level/xp:

```tsx
        <WelcomeHero name={name} streak={metrics.currentStreak} rank={viewerRank} total={allTimeBoard.length} race={leaders.slice(0, 3)} level={xp.level.level} xp={xp.totalXp} />
```

Render `DailyQuests` right after `<LogTradeBanner />` (line 142):

```tsx
        <DailyQuests quests={xp.daily} />
```

- [ ] **Step 4: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/feed/_components/DailyQuests.tsx app/src/app/feed/_components/WelcomeHero.tsx app/src/app/page.tsx
git commit -m "feat(app): home daily-quests widget + level/XP chip"
```

---

## Task 8: Leaderboard — category tabs + XP board

**Files:**
- Create: `app/src/app/leaderboard/_components/LeaderboardTabs.tsx`, `app/src/app/leaderboard/_components/XpTable.tsx`
- Modify: `app/src/app/leaderboard/_components/LeaderboardControls.tsx`

- [ ] **Step 1: Create `LeaderboardTabs.tsx`**

```tsx
// app/src/app/leaderboard/_components/LeaderboardTabs.tsx
'use client'

import { useRouter, useSearchParams } from 'next/navigation'

const CATS = [
  { key: 'performance', label: 'Performance' },
  { key: 'xp', label: 'XP' },
] as const

export function LeaderboardTabs({ cat }: { cat: string }) {
  const router = useRouter()
  const sp = useSearchParams()
  const go = (next: string) => {
    const p = new URLSearchParams(sp.toString())
    p.set('cat', next)
    p.delete('sort') // sort only applies to performance
    router.push(`/leaderboard?${p.toString()}`)
  }
  return (
    <div className="lb-segs" style={{ marginBottom: 14 }}>
      {CATS.map((c) => (
        <button key={c.key} className={'lb-seg' + (cat === c.key ? ' on' : '')} onClick={() => go(c.key)}>{c.label}</button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Create `XpTable.tsx`**

```tsx
// app/src/app/leaderboard/_components/XpTable.tsx
'use client'

import { useMemo, useState } from 'react'
import { FollowButton } from '@/app/_components/FollowButton'
import { Avatar } from './Avatar'

export type XpRow = {
  rank: number; userId: string; username: string; displayName: string | null; avatarUrl: string | null
  xp: number; level: number
}

const PAGE_SIZE = 8

export function XpTable({ rows, viewerId }: { rows: XpRow[]; viewerId: string }) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => (r.displayName ?? '').toLowerCase().includes(q) || r.username.toLowerCase().includes(q))
  }, [query, rows])

  if (rows.length === 0) {
    return <div className="lb-panel lb-empty">No XP earned in this window yet — log public trades to climb.</div>
  }

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pages - 1)
  const slice = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)
  const from = filtered.length ? safePage * PAGE_SIZE + 1 : 0
  const to = Math.min(filtered.length, (safePage + 1) * PAGE_SIZE)

  return (
    <div className="lb-panel">
      <div className="lb-panel-h" style={{ flexWrap: 'wrap', rowGap: 10 }}>
        <h2>All Traders</h2>
        <div className="lb-toolbar">
          <div className="lb-pager">
            <span className="cnt">{from}–{to} of {filtered.length}</span>
            <button className="lb-pgbtn" disabled={safePage === 0} onClick={() => setPage(safePage - 1)} aria-label="Previous page">‹</button>
            <button className="lb-pgbtn" disabled={safePage >= pages - 1} onClick={() => setPage(safePage + 1)} aria-label="Next page">›</button>
          </div>
          <label className="lb-tsearch">
            <span aria-hidden>⌕</span>
            <input placeholder="Search traders…" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0) }} />
          </label>
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="lb-table">
          <thead><tr><th style={{ width: 64 }}>Rank</th><th>Trader</th><th className="num">Level</th><th className="num">XP</th><th className="num">Action</th></tr></thead>
          <tbody>
            {slice.map((t) => {
              const self = t.userId === viewerId
              return (
                <tr key={t.userId} className={self ? 'me' : ''}>
                  <td><span className={'lb-rk' + (t.rank <= 3 ? ' g' + t.rank : '')}>{t.rank}</span></td>
                  <td>
                    <div className="lb-trader">
                      <Avatar src={t.avatarUrl} name={t.displayName || t.username} size={38} ring={t.rank <= 3} />
                      <div className="who" style={{ minWidth: 0 }}>
                        <b>{t.displayName || t.username}{self && <span className="lb-you">You</span>}</b>
                        <span>@{t.username}</span>
                      </div>
                    </div>
                  </td>
                  <td className="num"><span className="lb-cellnum">Lvl {t.level}</span></td>
                  <td className="num"><span className="lb-cellnum">{t.xp.toLocaleString()}</span></td>
                  <td className="num">{self ? <span className="lb-act self">You</span> : <FollowButton targetId={t.userId} initialFollowing={false} />}</td>
                </tr>
              )
            })}
            {slice.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: '34px 0', color: 'var(--faint)' }}>No traders match “{query}”.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Modify `LeaderboardControls.tsx` — hide day seg + sort on XP tab**

Change the signature and render to accept `cat`, drop `day` and `sort` when XP:

```tsx
export function LeaderboardControls({ period, sort, cat }: { period: string; sort: string; cat: string }) {
  const router = useRouter()
  const sp = useSearchParams()
  const push = (next: Record<string, string>) => {
    const p = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(next)) p.set(k, v)
    router.push(`/leaderboard?${p.toString()}`)
  }
  const periods = cat === 'xp' ? PERIODS.filter((p) => p.key !== 'day') : PERIODS
  return (
    <div className="lb-filters">
      <div className="lb-segs">
        {periods.map((p) => (
          <button key={p.key} className={'lb-seg' + (period === p.key ? ' on' : '')} onClick={() => push({ period: p.key })}>{p.label}</button>
        ))}
      </div>
      {cat !== 'xp' && (
        <div className="lb-metric">
          <select value={sort} onChange={(e) => push({ sort: e.target.value })}>
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <span className="chev" aria-hidden>▾</span>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: no errors (page.tsx will still error on the changed `LeaderboardControls` prop until Task 9 — acceptable mid-task; if running typecheck standalone, complete Task 9 first then check). Proceed to commit.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/leaderboard/_components/LeaderboardTabs.tsx app/src/app/leaderboard/_components/XpTable.tsx app/src/app/leaderboard/_components/LeaderboardControls.tsx
git commit -m "feat(app): leaderboard category tabs + XP table + controls gating"
```

---

## Task 9: Leaderboard page — wire XP category & rail

**Files:**
- Modify: `app/src/app/leaderboard/page.tsx`

- [ ] **Step 1: Rewrite `page.tsx`**

```tsx
// app/src/app/leaderboard/page.tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPerformanceRanking } from '@/lib/server/ranking'
import { getXpRanking, getUserXp } from '@/lib/server/xp'
import type { Period, PerfSort } from '@/lib/leaderboard'
import { LeaderboardTabs } from './_components/LeaderboardTabs'
import { LeaderboardControls } from './_components/LeaderboardControls'
import { Podium } from './_components/Podium'
import { LeaderboardTable, type BoardRow } from './_components/LeaderboardTable'
import { XpTable, type XpRow } from './_components/XpTable'
import { YourStanding } from './_components/YourStanding'

const PERIOD_LABEL: Record<Period, string> = { day: 'today', week: 'this week', month: 'this month', all: 'all time' }

type Search = { cat?: string; period?: string; sort?: string }

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams
  const cat = (['performance', 'xp'].includes(sp.cat ?? '') ? sp.cat : 'performance') as 'performance' | 'xp'
  // XP board has no 'day' window; default both tabs to 'week'.
  const allowedPeriods = cat === 'xp' ? ['week', 'month', 'all'] : ['day', 'week', 'month', 'all']
  const period = (allowedPeriods.includes(sp.period ?? '') ? sp.period : 'week') as Period
  const sort = (['pnl', 'winRate', 'avgR', 'trades'].includes(sp.sort ?? '') ? sp.sort : 'pnl') as PerfSort

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <main className="ts-page ts-feed lb-app">
      <div className="ts-feed-main lb-main">
        <header className="lb-head"><div className="tx">
          <h1 className="ts-h1">Leaderboard</h1>
          <p>Top-performing traders ranked by profit, win rate, consistency — and now XP. Track the best in real time, discover rising talent, and see how you stack up.</p>
        </div></header>

        <LeaderboardTabs cat={cat} />
        <LeaderboardControls period={period} sort={sort} cat={cat} />

        {cat === 'performance'
          ? <PerformanceBoard supabase={supabase} period={period} sort={sort} userId={user.id} />
          : <XpBoard supabase={supabase} period={period} userId={user.id} />}
      </div>

      <aside className="ts-feed-side">
        <LeaderboardRail supabase={supabase} userId={user.id} cat={cat} period={period} />
      </aside>
    </main>
  )
}

async function PerformanceBoard({ supabase, period, sort, userId }: { supabase: Awaited<ReturnType<typeof createClient>>; period: Period; sort: PerfSort; userId: string }) {
  const entries = await getPerformanceRanking(supabase, period, sort)
  const rows: BoardRow[] = entries.map((e) => ({
    rank: e.rank, userId: e.userId, username: e.username, displayName: e.displayName, avatarUrl: e.avatarUrl,
    pnl: e.pnl, winRate: e.winRate, avgR: e.avgR, trades: e.trades,
  }))
  return (
    <>
      {rows.length > 0 && (
        <section>
          <div className="lb-section-h"><h2>Top performers</h2><span className="lb-section-sub">{PERIOD_LABEL[period]}</span></div>
          <Podium top={rows.slice(0, 3)} viewerId={userId} />
        </section>
      )}
      <LeaderboardTable rows={rows} viewerId={userId} />
    </>
  )
}

async function XpBoard({ supabase, period, userId }: { supabase: Awaited<ReturnType<typeof createClient>>; period: Period; userId: string }) {
  const entries = await getXpRanking(supabase, period)
  const rows: XpRow[] = entries.map((e) => ({
    rank: e.rank, userId: e.userId, username: e.username, displayName: e.displayName, avatarUrl: e.avatarUrl, xp: e.xp, level: e.level,
  }))
  // Podium reuses BoardRow shape; map XP into the pnl slot for the value display.
  const podium: BoardRow[] = rows.slice(0, 3).map((r) => ({
    rank: r.rank, userId: r.userId, username: r.username, displayName: r.displayName, avatarUrl: r.avatarUrl,
    pnl: r.xp, winRate: 0, avgR: 0, trades: r.level,
  }))
  return (
    <>
      {rows.length > 0 && (
        <section>
          <div className="lb-section-h"><h2>Top earners</h2><span className="lb-section-sub">{PERIOD_LABEL[period]}</span></div>
          <Podium top={podium} viewerId={userId} />
        </section>
      )}
      <XpTable rows={rows} viewerId={userId} />
    </>
  )
}

async function LeaderboardRail({ supabase, userId, cat, period }: { supabase: Awaited<ReturnType<typeof createClient>>; userId: string; cat: 'performance' | 'xp'; period: Period }) {
  if (cat === 'xp') {
    const xp = await getUserXp(supabase, userId)
    const pct = Math.round(xp.level.progress * 100)
    return (
      <div className="ts-card ts-railcard">
        <div className="ts-rail-head"><h2 className="ts-h2">Your XP</h2><a href="/app/achievements" className="ts-link-sm">All</a></div>
        <p className="ach-xp mt-3">Level {xp.level.level} · {xp.totalXp.toLocaleString()} XP</p>
        <div className="ach-bar mt-3"><i style={{ width: pct + '%' }} /></div>
        <p className="faint mt-3" style={{ fontSize: 13 }}>{xp.level.xpIntoLevel.toLocaleString()} / {xp.level.xpToNext.toLocaleString()} XP to level {xp.level.level + 1}</p>
      </div>
    )
  }
  const allTime = await getPerformanceRanking(supabase, 'all')
  const me = allTime.find((e) => e.userId === userId) ?? null
  const leader = allTime[0] ?? null
  return (
    <YourStanding
      rank={me?.rank ?? null}
      total={allTime.length}
      pnl={me?.pnl ?? 0}
      winRate={me?.winRate ?? 0}
      periodLabel={PERIOD_LABEL[period]}
      leaderPnl={leader?.pnl ?? null}
      leaderHandle={leader && leader.userId !== userId ? leader.username : null}
    />
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/leaderboard/page.tsx
git commit -m "feat(app): wire leaderboard XP category, board, and Your XP rail"
```

---

## Task 10: Profile — derived Level/XP + earned badges

**Files:**
- Modify: `app/src/app/[username]/page.tsx`

- [ ] **Step 1: Import `getUserXp`** (after line 7 `getPerformanceRanking` import):

```tsx
import { getUserXp } from '@/lib/server/xp'
```

- [ ] **Step 2: Fetch derived XP for the profile owner** — after the `profileRank` block (around line 77), add:

```tsx
  // Derived XP/level (single source of truth; static profiles.xp/level columns are ignored).
  const profileXp = profileId ? await getUserXp(supabase, profileId) : null
  const earnedBadges = (profileXp?.badges ?? []).filter((b) => b.earned)
```

- [ ] **Step 3: Replace the static Level stat** — change line 105:

```tsx
          <div className="ts-stat"><dt>Level</dt><dd>{profileXp ? `Level ${profileXp.level.level} · ${profileXp.totalXp.toLocaleString()} XP` : '—'}</dd></div>
```

- [ ] **Step 4: Add an earned-badge showcase** — insert after the closing `</dl>` (line 108), before the card's closing `</div>` (line 109):

```tsx
        {earnedBadges.length > 0 && (
          <div className="mt-6">
            <div className="ts-rail-head"><p className="eyebrow">Badges</p><a href="/app/achievements" className="ts-link-sm">All</a></div>
            <div className="badge-grid mt-3">
              {earnedBadges.map((b) => (
                <div key={b.id} className="badge earned"><span className="badge-dot" aria-hidden>★</span><b>{b.label}</b></div>
              ))}
            </div>
          </div>
        )}
```

- [ ] **Step 5: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/src/app/[username]/page.tsx
git commit -m "feat(app): profile derived Level/XP stat + earned-badge showcase"
```

---

## Task 11: E2E + full test pass

**Files:**
- Create: `app/tests/e2e/xp.spec.ts`

- [ ] **Step 1: Inspect an existing e2e for the login/setup helper**

Run: `cat app/tests/e2e/leaderboard.spec.ts`
Expected: note the auth/setup helper and `baseURL` conventions; reuse the same login flow verbatim in the new spec.

- [ ] **Step 2: Write `xp.spec.ts`** (adapt the auth helper from Step 1 — replace `loginAsTestUser`/fixtures with whatever that file uses)

```ts
// app/tests/e2e/xp.spec.ts
import { test, expect } from '@playwright/test'
// import { loginAsTestUser } from './helpers' // <- use the SAME helper leaderboard.spec.ts uses

test.describe('XP & achievements', () => {
  test('achievements page shows level, quests, and badges', async ({ page }) => {
    // await loginAsTestUser(page)
    await page.goto('/app/achievements')
    await expect(page.getByRole('heading', { name: 'Achievements' })).toBeVisible()
    await expect(page.getByText(/XP total/)).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Daily quests' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Badges' })).toBeVisible()
  })

  test('leaderboard XP tab switches and renders an XP board', async ({ page }) => {
    // await loginAsTestUser(page)
    await page.goto('/app/leaderboard')
    await page.getByRole('button', { name: 'XP' }).click()
    await expect(page).toHaveURL(/cat=xp/)
    // Either a populated table header or the empty-state copy is acceptable.
    await expect(page.locator('.lb-panel')).toBeVisible()
  })
})
```

- [ ] **Step 3: Warm the dev server, then run e2e** (per CLAUDE.md: never `npm run build` while dev runs; cold compile busts 5s timeouts)

Run:
```bash
cd app && npm run dev   # in a separate terminal; wait until it serves
# then, against the warm server:
cd app && npx playwright test xp.spec.ts
```
Expected: both tests PASS.

- [ ] **Step 4: Full unit suite**

Run: `cd app && npm test`
Expected: all suites PASS (including `xp.test.ts` and existing `leaderboard.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add app/tests/e2e/xp.spec.ts
git commit -m "test(app): e2e for achievements page + leaderboard XP tab"
```

---

## Task 12: Final verification & merge prep

- [ ] **Step 1: Typecheck + lint + unit** (dev server stopped)

Run: `cd app && npx tsc --noEmit && npm run lint && npm test`
Expected: clean.

- [ ] **Step 2: Manual smoke** (warm dev server): visit `/app/achievements`, `/app/leaderboard?cat=xp`, home (quests widget + level chip), a public profile (Level/XP stat + badges). Confirm levels are non-trivial for users with existing trades (backfill working).

- [ ] **Step 3: Merge per workflow** — `finishing-a-development-branch` (merge `phase5-xp` → main, then push).

---

## Self-Review Notes (author)

- **Spec coverage:** §2 pure logic → Tasks 1–4; §3 server → Task 5; §4.1 achievements → Task 6; §4.2 home → Task 7; §4.3 leaderboard XP tab → Tasks 8–9; §4.4 profile → Task 10; §6 tests → Tasks 1–4, 11. No migration (§ matches). ✓
- **Type consistency:** `XpTrade`, `LevelInfo`, `QuestProgress`, `EvaluatedBadge`, `Period` defined in Task 1–4, consumed unchanged in Task 5; `XpRow` (Task 8) mirrors `XpRankedEntry` (Task 5) field-for-field; `getUserXp`/`getXpRanking` signatures stable across Tasks 6–10. ✓
- **Reality reconciliations baked in:** static `profiles.xp/level` ignored (Task 10 uses derived); leaderboard had no tabs → Task 8 adds them. ✓
- **Known minor:** `windowXp` base counts closed trades by `closed_at` while `totalXpFromTrades` counts by `status` — equal in practice (closed trades always carry `closed_at` per `actions/trade.ts`). Documented in spec §2.
