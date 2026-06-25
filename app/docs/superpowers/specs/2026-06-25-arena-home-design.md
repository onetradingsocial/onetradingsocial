# Arena Home Page — Design

Date: 2026-06-25
Status: Approved

## Goal

Rebuild the logged-in home page (`src/app/page.tsx` body) to match the attached
"Arena" mockup (`TradingSocial Home (offline) (1).html`, a Babel/React bundle),
wired to the real Supabase data the page already fetches. Keep it functional.

## Scope decisions (confirmed with user)

- **Nav**: home page only. Keep the global `AppNav`, `TradeModalProvider`, fonts,
  and `HelpWidget`. Do **not** build the mockup's `TopNav`/notifications/messages.
- **Stub features**: derive from real data where possible, omit the rest.
  - Derive: the "race"/standing hero and "Trader of the week" from the real week
    leaderboard; streak from `metrics.currentStreak`; level/XP from `getUserXp`.
  - Omit: notifications feed, direct messages, in-feed AI insight, in-feed emotion
    check-in, copy-to-journal (rendered disabled).
- **Hero**: the Arena command center (weekly standing + race + streak check-in).
- Stat sparklines and the race "gap" copy are decorative/derived (no per-stat
  historical series is fetched).
- Feed "Trending" tab sorts by engagement (likes + comments) as a stand-in.

## CSS

Port the mockup's `h-` design system to one global stylesheet
`src/app/feed/_components/home/home-arena.css`, following the existing `.lb-app`
convention in `globals.css`:

- The mockup's `:root { … }` tokens move under `.h-app { … }` (scoped; cannot
  leak to other pages). Reuse the same token→token mapping the `.lb-app` block
  uses (`--card: var(--surface)`, `--line: var(--border)`, etc.) plus the
  mockup-only tokens (`--card-2`, `--bg-soft`, `--up-ink`, `--silver`, `--bronze`,
  `--grad-r`, `--grad-soft`, `--ink`, `--on-ink*`, `--r-sm`, `--sh-vio`, …).
- `--display/--body/--mono` already resolve to the app's next/font variables.
- The global reset (`* { box-sizing… }`) is scoped to `.h-app *` so it can't
  clobber other pages.
- Component selectors stay as authored (`.h-nav`, `.h-stat`, `.h-trade`, …); they
  only appear inside `.h-app` on this page. Shared names (`.h-btn`, `.h-grad-text`,
  `.h-bar`, `.h-ink-grid`) keep the leaderboard's higher-specificity overrides.

## Components (new dir `src/app/feed/_components/home/`, all client)

- `atoms.tsx` — `Icon`, `Sparkline`, `Ring`, `StreakChain`, `Avatar`, `Delta`,
  ported from the mockup. `Avatar` renders the real `avatar_url` with the gradient
  fallback.
- `HomeArena.tsx` — `.h-app` shell + `.h-main` layout. Receives serializable props
  from `page.tsx`. Uses `useTradeModal().open()` for the log-trade actions. Owns the
  feed `filter` state.
- `CmdArena.tsx` — hero. Left: rank / league / streak chain + "Log a trade" /
  "Check in". Right: "the race" = top-3 of the week board with the viewer
  highlighted and gap math. Props: viewer rank, week leaders, streak, level, name.
- `StatRow.tsx` — 5 cards from real `metrics` (overall rank, total P/L, win rate,
  avg R:R, total trades). Sparklines decorative (seeded).
- `LogTradeBand.tsx` — opens the trade modal; "logged today" / "XP earned" derived
  from today's trades and `xp`.
- `Composer.tsx` — reuses `createPost`; "Attach trade" opens the trade modal.
  Reuses the existing image/poll attach flow where practical.
- `ArenaFeed.tsx` + `ArenaPostCard.tsx` — segmented All / Following / Trending over
  the real feed items. The card reuses `LikeButton`, `CommentThread`, the `follow`
  action, and the existing `TradeAttachment` / `ImageGallery` / `PollAttachment`,
  restyled with the mockup's trade-chart + stat visuals.
- Rail widgets: `TraderOfWeek.tsx` (week #1 leader), `TopTraders.tsx` (week board),
  `Quests.tsx` (real daily quests, read-only), `RecentTrades.tsx` (real recent
  trades).

## Data flow

`page.tsx` keeps its current parallel data assembly (profile, week/all-time boards,
xp, follows, posts + attachments, own trades → metrics + recent + spark). It maps
that to serializable props and renders a single `<HomeArena … />`. No new server
queries except small derivations (today's trade count). All interactivity goes
through existing server actions.

## Out of scope / risks

- No backend for messages, notifications, AI grading, copy-to-journal — visually
  omitted or disabled.
- The mockup's own `QuickTradeModal` is **not** rebuilt; the app's existing
  `TradeModalProvider` modal already matches it and is reused.
- Mixed `h-` (home) and `ts-`/`lb-` (rest of app) class systems coexist; `.h-app`
  scoping prevents cross-contamination.
