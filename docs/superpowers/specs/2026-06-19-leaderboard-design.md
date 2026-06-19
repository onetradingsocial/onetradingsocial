# TradingSocial App — Phase 4: Leaderboard

**Date:** 2026-06-19
**Status:** Approved (design)
**Depends on:** Phase 2 (trades), Phase 3 (follows, home/profile rank placeholders). No new tables.

---

## 1. Goals

Rank traders so the community has status + proof. Replace the home/profile rank placeholders with real positions and add a dedicated `/app/leaderboard` page laid out like `TradingSocial Leaderboard (offline).html` (top-3 podium + full ranked table + right rail).

**Confirmed decisions:**
- Categories: **Performance, Consistency, Most Followed** (real) + **XP, Learning Hub** ("soon" tabs, wired in Phases 5/6).
- Performance shows **Total P&L, Win rate, Avg R:R, Trades**; sortable, default **Total P&L** (per the template). Tie-break by trades.
- Windows: **This week / This month / All-time** (filter `traded_at`). Most Followed is all-time only.
- **Public closed trades + public profiles only** → private traders never appear (privacy by construction).
- **No migration** — read-only over existing tables.

**Out of scope:** XP/Learning ranking, leagues/badges, weekly-reset jobs, follower-growth windowing, "top movers"/"daily quests"/"tips" widgets (rendered as styled placeholders).

---

## 2. Pure ranking — `lib/leaderboard.ts` (unit-tested)

Input rows come from queries (§3); these functions are pure (no I/O).

- `aggregatePerformance(trades: PerfTrade[])` → `Map<userId, Agg>` where `Agg = { userId, pnl, wins, losses, winRate, avgR, trades }`. Counts only `trades` ≥ 1 (a user appears with ≥1 closed trade in the window). `pnl = Σ pnl_amount`, `avgR = mean r_multiple`, `winRate = wins / trades`.
- `rankPerformance(aggs: Agg[], sort: 'pnl'|'winRate'|'avgR'|'trades')` → `Ranked[]` sorted desc by the chosen field, tie-break by `trades` desc then `pnl` desc; each gets `rank` (1-based, dense). Default sort `pnl`.
- `rankConsistency(trades: { user_id: string }[])` → per-user logged-trade count, ranked desc.
- `rankFollowers(follows: { following_id: string }[])` → per-`following_id` count, ranked desc.
- `windowStart(period: 'week'|'month'|'all', now: number)` → ISO cutoff (`week` = now−7d, `month` = now−30d, `all` = null).

`PerfTrade = { user_id, pnl_amount, r_multiple, outcome }` (already filtered to public+closed+window by the query).

---

## 3. Data flow (server)

`/app/leaderboard` (server component), params `?cat=performance|consistency|followed` (default performance), `?period=week|month|all` (default week), `?sort=pnl|winRate|avgR|trades` (default pnl).

1. **Performance / Consistency:** `select user_id, pnl_amount, r_multiple, outcome, traded_at from trades where is_public = true and status = 'closed'` + `.gte('traded_at', windowStart)` when not all-time. Pass to the pure aggregator/ranker.
2. **Most Followed:** `select following_id from follows` → `rankFollowers`.
3. Join the ranked `userId`s to `profiles` (username, display_name, avatar_url) — only public, onboarded profiles; drop any rows whose profile is missing/private.
4. The viewer's own rank = their index in the **all-time Performance** ranking (computed for the rank card + reused by profile/home).

For small early data this app-side aggregation is fine; revisit with a Postgres view if it grows.

---

## 4. UI — matches the template

`/app/leaderboard`:
- **Header:** "Leaderboard" + subtitle ("Top traders ranked by performance, consistency, and following — updated live.").
- **Tabs (`LeaderboardTabs`):** Performance · Consistency · Most Followed · XP `soon` · Learning `soon`.
- **Controls:** period segmented (This week / This month / All-time) + sort dropdown (Performance only: Total P&L / Win rate / Avg R:R / Trades). Hidden window on Most Followed.
- **Podium (`Podium`):** top 3 as cards — **#1 elevated center** (crown), #2 left, #3 right; avatar, name, @username, headline metric (P&L for performance), stat row (win% · R:R · trades), Follow/View buttons.
- **All Traders (`LeaderboardTable`):** ranked rows — rank badge, `UserLink`, headline metric + a proportion bar, win%, avg R, trades, `FollowButton`. The viewer's own row highlighted.
- **Right rail:** the viewer's **rank card** (gradient, "#N · top X%") + styled "soon" widgets (Daily quests, Top movers) reusing the home rail style.

Empty state: "No ranked trades in this window yet — log public trades to climb."

`NavLinks`: the "Leaderboard" pill becomes a real `<Link href="/leaderboard">` (drop the `--soon`).

---

## 5. Wire the placeholders to real data

- **Home `RightRail` "Leaderboard · this week"** → top 5 Performance (week), real P&L; drop the "soon" / "—".
- **Home `WelcomeHero` "The race"** → top 3 Performance (week).
- **Profile `[username]` `#—`** → that profile's position on the all-time Performance board (`#N`, or "Unranked" if no qualifying trades).

These reuse the same `lib/leaderboard.ts` functions + a small shared server helper `getPerformanceRanking(supabase, period)` to avoid duplicating the query.

---

## 6. Error handling / edges

- No trades in window → empty state, podium hidden.
- Fewer than 3 ranked → podium shows what exists (1–2 cards).
- A ranked user whose profile turned private/missing → filtered out post-join.
- Self-follow / following self never offered (FollowButton hidden on own row).
- Division by zero (winRate, avgR with 0 trades) → user not included (min 1 trade).

---

## 7. Testing

- **Vitest:** `aggregatePerformance` (pnl/winRate/avgR per user), `rankPerformance` (each sort key + tie-break + dense rank numbers), `rankConsistency`, `rankFollowers`, `windowStart`.
- **Playwright:** two users each log a public closed trade with different P&L → open `/app/leaderboard` → both appear, higher P&L ranked above; switch period; the nav "Leaderboard" link opens the page.

---

## 8. Components / files

```
app/src/lib/leaderboard.ts                       # pure aggregate + rank + windowStart
app/src/lib/server/ranking.ts                    # getPerformanceRanking(supabase, period) shared query
app/src/app/leaderboard/page.tsx                 # board page
app/src/app/leaderboard/_components/
    LeaderboardTabs.tsx
    LeaderboardControls.tsx                      # period + sort
    Podium.tsx
    LeaderboardTable.tsx
    RankCard.tsx                                 # right-rail viewer rank
app/src/app/_components/NavLinks.tsx             # Leaderboard -> real link (modify)
app/src/app/feed/_components/RightRail.tsx       # real top-5 (modify)
app/src/app/feed/_components/WelcomeHero.tsx     # real top-3 race (modify)
app/src/app/[username]/page.tsx                  # real rank (modify)
app/src/app/globals.css                          # podium + table + rank card styles (modify)
app/tests/unit/leaderboard.test.ts
app/tests/e2e/leaderboard.spec.ts
```

---

## 9. Deliverables checklist

- [ ] `lib/leaderboard.ts` (+ unit tests).
- [ ] `lib/server/ranking.ts` shared query helper.
- [ ] `/app/leaderboard` page: tabs, controls, podium, table, rank card.
- [ ] Leaderboard CSS (podium, table, rank card) matching the template.
- [ ] Nav "Leaderboard" real link.
- [ ] Wire home RightRail + WelcomeHero race + profile rank to real data.
- [ ] Vitest + Playwright suites.
