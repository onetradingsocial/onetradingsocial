// Meaningful streaks (Sprint 4, row 34). Reward good process — journaling,
// reviews, rule compliance, learning — NEVER trade volume or profit. Pure.

export type StreakInputs = {
  // Sorted-desc distinct day keys (YYYY-MM-DD, UTC) where the behaviour happened.
  journalDays: string[]       // days a trade was logged
  /**
   * Days carrying a process entry — a review, a rule reflection, a planned
   * no-trade session or a scheduled rest (`process_logs`, migration 0070).
   *
   * ── Audit 2026-09-05, P0 ──────────────────────────────────────────────────
   *
   * Unioned into the journaling streak below. Before this, `journalDays` was
   * "days a trade was logged" and nothing else, so the streak the product calls
   * "good process — not trade volume or profit" broke on any day the trader
   * correctly stood aside. That is a trade-volume streak wearing a process
   * streak's label, and on a screen whose own subtitle disclaims it.
   */
  processDays: string[]
  reviewDays: string[]        // days a review was completed (or the Trader+ card viewed)
  compliantDays: string[]     // days where every closed trade followed the rules
  learningDays: string[]      // days a lesson was completed
  todayKey: string            // current UTC day key
}

export type Streak = { id: string; label: string; icon: string; days: number }

// Count consecutive days ending today (or yesterday — grace so an un-acted
// today doesn't reset a live streak) present in the set.
function consecutiveDays(daySet: Set<string>, todayKey: string): number {
  const DAY = 864e5
  const today = Date.parse(todayKey + 'T00:00:00Z')
  // Allow the streak to "hang" if today isn't done yet: start from today if
  // present, else yesterday.
  let cursor = daySet.has(todayKey) ? today : today - DAY
  let n = 0
  while (daySet.has(new Date(cursor).toISOString().slice(0, 10))) {
    n++
    cursor -= DAY
  }
  return n
}

export function computeStreaks(x: StreakInputs): Streak[] {
  const mk = (id: string, label: string, icon: string, days: string[]): Streak => ({
    id, label, icon, days: consecutiveDays(new Set(days), x.todayKey),
  })
  return [
    // A day you logged a trade OR recorded any process entry. The union is the
    // fix: a deliberate no-trade day is journaling, and treating it as a gap
    // penalised the decision the product exists to encourage.
    mk('journal', 'Journaling', '📓', [...x.journalDays, ...x.processDays]),
    mk('review', 'Reviews', '📊', x.reviewDays),
    mk('compliance', 'Rule compliance', '✅', x.compliantDays),
    // Learn hidden for now — we are not financial advisors. Restore
    // `mk('learning', 'Learning', '📚', x.learningDays),` here when compliant
    // (and put StreaksCard's grid back to 4 columns). `learningDays` is still
    // computed and passed in, so nothing upstream needs changing to restore.
  ]
}

/* ── The "don't break the chain" week strip ─────────────────────────────── */

export type ChainDay = 'done' | 'today' | 'missed' | 'future'

/**
 * The seven days of the week containing `todayKey`, Monday first, each labelled
 * with what actually happened.
 *
 * This replaces a function that never consulted a calendar at all. It placed
 * "today" at index 6 unconditionally — which the M T W T F S S labels render as
 * SUNDAY, every day of the week — and filled the six cells before it from
 * `Math.abs(streak)`, the win/loss TRADE streak. So four winning trades in one
 * afternoon painted Monday through Thursday as done, and a user who logged
 * every day but traded flat saw an empty chain. The card is titled "Don't break
 * the chain": it is the product's habit mechanic, and it was showing fiction.
 *
 * A day the user missed is deliberately its own state rather than being folded
 * into `future`. Rendering a missed Monday identically to an upcoming Friday
 * would be a smaller version of the same lie — the strip has to be able to say
 * "you didn't log that day", or it cannot say anything true about a chain.
 *
 * Day keys are UTC (`YYYY-MM-DD`), matching `StreakInputs.journalDays` and
 * `computeStreaks` above. No timezone is stored against a profile, so a trader
 * far from UTC sees the boundary fall mid-evening or mid-morning. That is a
 * known and pre-existing property of every streak in this file, not something
 * this function introduces — fixing it means storing a timezone and moving all
 * of them together.
 */
/**
 * `journalDays` is the union the CALLER builds: days a trade was logged plus days
 * carrying a process entry (see `StreakInputs.processDays`). The signature is
 * deliberately one flat list — the chain asks "did you show up", and after the
 * 2026-09-05 audit a planned no-trade day is showing up. Passing trade days
 * alone paints a disciplined flat week as four missed cells.
 */
export function weekChain(journalDays: string[], todayKey: string): ChainDay[] {
  const DAY = 864e5
  const today = Date.parse(todayKey + 'T00:00:00Z')
  if (Number.isNaN(today)) return Array<ChainDay>(7).fill('future')

  // getUTCDay() is 0=Sunday; the strip is Monday-first, so Sunday is index 6.
  const weekday = (new Date(today).getUTCDay() + 6) % 7
  const monday = today - weekday * DAY

  const logged = new Set(journalDays)
  const out: ChainDay[] = []
  for (let i = 0; i < 7; i++) {
    const key = new Date(monday + i * DAY).toISOString().slice(0, 10)
    if (i === weekday) out.push(logged.has(key) ? 'done' : 'today')
    else if (i > weekday) out.push('future')
    else out.push(logged.has(key) ? 'done' : 'missed')
  }
  return out
}
