# TradingSocial App — Phase 5: XP, Quests & Badges

**Date:** 2026-06-22
**Status:** Approved (design)
**Depends on:** Phase 2 (trades), Phase 4 (leaderboard ranking pattern + "XP soon" tab). **No new tables.**

---

## 1. Goals

Add a trade-centric gamification layer — XP, levels, daily/weekly quests, and milestone badges — that rewards journaling **discipline** (not P&L chasing), and wire the leaderboard's existing "XP" placeholder tab to a real windowed XP ranking.

**Confirmed decisions:**
- **Full gamification this phase:** XP + levels + quests + badges (one spec, phased plan).
- **XP source = trade activity only**, **flat per closed trade** (win/loss/size-agnostic — rewards consistency, never encourages over-trading or hiding losses). Quests grant bonus XP; badges are milestones.
- **Architecture A — Derived, no migration.** All XP/level/quest/badge state is a pure function of the `trades` table + clock, mirroring `lib/leaderboard.ts` + `lib/server/ranking.ts`. Backfill of existing trades is automatic and consistent (past closed trades already count).
- **Rising-cost level curve.** Daily **and** weekly quests. **UTC** day / ISO-week boundaries (v1).
- **Windowed XP leaderboard** (this week / this month / all-time), like Performance.
- **Badges:** trade-count, level, quest-streak, win-streak categories.
- **Reset = derive-on-read.** No cron/scheduler infra.
- **UI home = dedicated `/app/achievements` page**; compact widgets on home/leaderboard/profile link to it.

**Out of scope:** social/learning XP sources (Phase 6 — would introduce an `xp_events` ledger at that point), XP decay, manual/admin badge awards, level-up notifications/toasts, per-user local-timezone quest boundaries.

---

## 2. Pure XP logic — `lib/xp.ts` (unit-tested)

All functions pure (no I/O); `now: number` (epoch ms) injected for deterministic tests.

### Constants (tunable, exported)
```
BASE_PER_TRADE     = 50    // XP per closed trade
DAILY_QUEST_BONUS  = 30    // per daily quest completed
WEEKLY_QUEST_BONUS = 150   // per weekly quest completed
LEVEL_BASE         = 100   // level-curve scale
```
> ⚠️ Because totals are **derived**, changing these constants retroactively re-levels every user. That is acceptable for v1 (pre-launch tuning); locked once live. A ledger (Phase 6) would freeze constants at grant time.

### Level curve (rising cost)
- Cost to go from level `L` → `L+1` = `LEVEL_BASE · L`.
- Cumulative XP required to **reach** level `L` = `LEVEL_BASE · (L−1)·L / 2`.
  - L1@0, L2@100, L3@300, L4@600, L5@1000, L10@4500, L25@30000.
- `xpForLevel(level: number): number` → cumulative threshold (inverse of below).
- `levelFromXp(totalXp: number)` → `{ level, xpIntoLevel, xpToNext, progress }`
  - `level` = highest L with `xpForLevel(L) ≤ totalXp` (≥1).
  - `xpIntoLevel` = `totalXp − xpForLevel(level)`; `xpToNext` = `xpForLevel(level+1) − xpForLevel(level)`; `progress` = `xpIntoLevel / xpToNext` (0–1).

### Quest definitions (data-driven)
Daily and weekly quests are declared as data so UI and XP math share one source:
```
DAILY_QUESTS  = [
  { id: 'log_trade',   label: 'Log a trade today',     target: 1, metric: 'created' },
  { id: 'close_trade', label: 'Close a trade today',   target: 1, metric: 'closed'  },
]
WEEKLY_QUESTS = [
  { id: 'log_10',  label: 'Log 10 trades this week',   target: 10, metric: 'created' },
  { id: 'close_5', label: 'Close 5 trades this week',  target: 5,  metric: 'closed'  },
]
```
- `metric: 'created'` counts trades by **`traded_at`** (when the trade happened); `'closed'` counts by **`closed_at`** (status closed).

### Boundaries (UTC)
- `utcDayStart(now)` → epoch ms of 00:00:00 UTC for `now`'s date.
- `utcWeekStart(now)` → epoch ms of Monday 00:00 UTC (ISO week).
- `dayKey(ms)` → `'YYYY-MM-DD'` (UTC); `weekKey(ms)` → `'YYYY-Www'` (ISO).

### Quest progress (current window)
- `dailyQuestProgress(trades, now)` → `Array<{ id, label, target, current, done }>` counting today's (UTC) trades per `metric`.
- `weeklyQuestProgress(trades, now)` → same for this ISO week.

### Historical quest bonus (keeps derived total consistent)
A daily quest is "completed on day D" if that day's metric count ≥ target. Summed over history:
- `historicalDailyBonus(trades)` = `DAILY_QUEST_BONUS · Σ_quest (count of distinct UTC days meeting that quest's target)`.
- `historicalWeeklyBonus(trades)` = `WEEKLY_QUEST_BONUS · Σ_quest (count of distinct ISO weeks meeting target)`.

### Totals
- `totalXpFromTrades(trades)` = `BASE_PER_TRADE · (#closed trades) + historicalDailyBonus(trades) + historicalWeeklyBonus(trades)`.
- `windowXp(trades, period, now)` → XP **earned within** the window (`week`=now−7d, `month`=now−30d, `all`=all): closed trades whose `closed_at` ≥ cutoff × BASE, plus daily/weekly quest bonuses for day/week buckets whose boundary start ≥ cutoff. Used by the XP leaderboard board. `all` equals `totalXpFromTrades`.

### Streaks & badges
- `questStreak(trades, now)` → count of consecutive UTC days **up to and including today** where **all** daily quests were completed (breaks on first incomplete prior day; today incomplete ⇒ streak continues from yesterday's run but today not counted until done).
- `winStreakMax(closedTradesChrono)` → longest run of consecutive `outcome === 'win'` over closed trades ordered by `closed_at`.
- `BADGES` (declared as data): for each, an `id`, `category`, `label`, `threshold`, and a selector of the stat it reads.
  - **trade-count:** 1, 10, 50, 100, 500 closed trades.
  - **level:** reach L5, L10, L25.
  - **quest-streak:** 7-day, 30-day daily-quest streak (max ever, derived from per-day completion history).
  - **win-streak:** 5, 10 consecutive winning closed trades.
- `evaluateBadges(stats)` → `Array<{ id, category, label, threshold, earned, current }>` where `stats = { closedCount, level, maxQuestStreak, maxWinStreak }`. `earned = current ≥ threshold`; `current` drives the locked-badge progress bar.

`XpTrade = { traded_at: string; closed_at: string | null; status: 'open'|'closed'; outcome: string }` (the minimal projection all functions consume).

---

## 3. Server aggregation — `lib/server/xp.ts`

- `getUserXp(supabase, userId)`:
  1. Fetch that user's trades (`traded_at, closed_at, status, outcome`).
  2. Compute `totalXp = totalXpFromTrades`, `levelFromXp`, `dailyQuestProgress`, `weeklyQuestProgress`, `questStreak`, badges via `evaluateBadges`.
  3. Return a typed `UserXp` for the achievements page, home widget, and profile.
- `getXpRanking(supabase, period)`: clone of `getPerformanceRanking` —
  1. Query **public closed** trades (`user_id, traded_at, closed_at, status, outcome`), no window in SQL (windowing happens in `windowXp`, which also needs quest-day buckets).
  2. Group by `user_id`; compute `windowXp(userTrades, period, now)` per user.
  3. Drop users with 0 window XP; keep only **public, onboarded** profiles; dense-rank desc, tie-break by total closed trades then earlier `created_at`.
  4. Join `username/display_name/avatar_url`; return `XpRankedEntry[]` `{ rank, userId, username, displayName, avatarUrl, xp, level }`.

---

## 4. Surfaces

1. **`/app/achievements`** (new server route, under app `basePath`):
   - **Hero:** level badge, total XP, progress bar to next level (`xpIntoLevel/xpToNext`), current quest streak.
   - **Quests:** daily list + weekly list, each a row with label, `current/target`, progress bar, done check, and the XP reward.
   - **Badges:** grid grouped by category; earned badges full-color with (optional) note, locked badges dimmed with a `current/threshold` progress hint.
2. **Home** (`app/page.tsx` + `feed/_components/WelcomeHero.tsx`):
   - Replace the styled **quest placeholder** with a compact **daily-quests** widget (top 2–3, progress) linking to `/app/achievements`.
   - Add a **level/XP chip** in `WelcomeHero` alongside the existing trade-streak chip. (The existing trade win/loss streak chip stays — distinct concept.)
3. **Leaderboard** (`leaderboard/page.tsx` + a new `_components/LeaderboardTabs.tsx` + table):
   - **Reality check:** the merged leaderboard is **Performance-only** — there is no category-tab UI yet (the only "soon" placeholder is a *Daily quests* right-rail card). So this phase **adds** a minimal category tab control: **Performance** (existing board) | **XP** (new). No Consistency/Followed/Learning tabs (not built; out of scope).
   - Tab routing via `?cat=performance|xp` (default `performance`). On `cat=xp`: period seg (week/month/all, **no `day`**, reusing `windowXp`), ranked via `getXpRanking`. Columns: Rank, Trader, **Level**, **XP**. Podium reused (value = `Lvl N · {xp} XP`).
   - Replace the "Daily quests · soon" rail card with a real **Your XP** mini-card (level, total XP, next-level progress) linking to `/app/achievements`.
4. **Profile** (`app/[username]/page.tsx`):
   - **Reality check:** profile already renders `Level {profile.level} · {profile.xp} XP` from the **static** `profiles.xp`/`profiles.level` columns (migration 0001, default `0`/`1` — currently wrong for everyone, never written). Switch this stat to the **derived** value from `getUserXp` so it's correct and single-source. The static columns are left in place but unread (dropping them is a separate cleanup, out of scope).
   - **Earned-badge showcase** (earned only; links to `/app/achievements`).

---

## 5. Data flow & integrity

- **No write path.** Closing a trade already updates `trades`; XP recomputes on next read. No hooks added to `actions/trade.ts`. No double-count risk.
- **Static `profiles.xp`/`profiles.level` are intentionally not read** — the derived `getUserXp` value is the single source of truth. The columns stay (no migration); a future cleanup may drop them.
- **Privacy:** the XP leaderboard reuses the leaderboard's public-closed-trades + public-profile filter, so private traders never appear. Per-user pages (`getUserXp`) read the owner's own trades (all visibilities) for their own achievements view; profile-page badges/level shown publicly derive only from that profile's trades consistent with existing profile exposure.
- **Performance:** `getXpRanking` scans public closed trades once (same shape/scale as the existing performance board). Acceptable at current volume; revisit with a materialized view if needed (not now).

---

## 6. Testing

- **Unit — `tests/unit/xp.test.ts` (vitest):**
  - level curve round-trips (`xpForLevel`/`levelFromXp`, boundaries L1/L2/L5/L10/L25, progress fraction).
  - `totalXpFromTrades` incl. historical daily/weekly bonuses (multi-day fixtures).
  - `dailyQuestProgress`/`weeklyQuestProgress` at UTC day/week edges (injected `now`).
  - `questStreak` (consecutive days, gap breaks, today-incomplete).
  - `winStreakMax` (runs, losses break, scratch/open ignored).
  - `windowXp` (week/month/all cutoffs; `all` == total).
  - `evaluateBadges` (earned vs locked, `current` progress).
- **E2E — `tests/e2e/xp.spec.ts` (playwright):** achievements page renders hero/quests/badges; leaderboard XP tab populates a ranked row; period seg switches. **Warm the dev server before running** (cold-compile busts the 5s `toHaveURL` on first test — per Phase 4 note).

---

## 7. Plan order (single spec → phased implementation plan)

1. `lib/xp.ts` pure logic **+ `xp.test.ts`** (TDD).
2. `lib/server/xp.ts` aggregation (`getUserXp`, `getXpRanking`).
3. `/app/achievements` page + components.
4. Home: real daily-quests widget + `WelcomeHero` level chip.
5. Leaderboard: wire XP tab (controls + server + table/podium/RankCard formatting).
6. Profile: level/XP stat + earned-badge showcase.
7. E2E `xp.spec.ts`; full `npm test`; warm-server e2e pass.

**Migration:** none.
