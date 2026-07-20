// Meaningful streaks (Sprint 4, row 34). Reward good process — journaling,
// reviews, rule compliance, learning — NEVER trade volume or profit. Pure.

export type StreakInputs = {
  // Sorted-desc distinct day keys (YYYY-MM-DD, UTC) where the behaviour happened.
  journalDays: string[]       // days a trade was logged
  reviewDays: string[]        // days a weekly review was viewed
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
    mk('journal', 'Journaling', '📓', x.journalDays),
    mk('review', 'Weekly reviews', '📊', x.reviewDays),
    mk('compliance', 'Rule compliance', '✅', x.compliantDays),
    mk('learning', 'Learning', '📚', x.learningDays),
  ]
}
