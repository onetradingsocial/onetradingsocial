// Personalised feed + trader recommendations (Backlog row 35).
//
// Scores candidate traders against the viewer's own profile so the feed isn't
// just "whoever posted most". Pure and unit-tested; the server supplies the
// candidate set.

import type { VerificationLevel } from '@/lib/verification'

export type ViewerProfile = {
  markets: string[]
  styles: string[]
  experience: string | null
  strategies: string[]      // strategy/setup tags from the viewer's own trades
  lessonsCompleted: number
}

export type CandidateTrader = {
  userId: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  markets: string[]
  styles: string[]
  experience: string | null
  strategies: string[]
  lessonsCompleted: number
  verification: VerificationLevel
  publicTrades: number
  followers: number
}

export type Recommendation = {
  userId: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  score: number
  reasons: string[]         // human-readable "why you're seeing this"
  verification: VerificationLevel
}

// Weights — verification is deliberately meaningful but not dominant, so a
// brand-new verified account can't outrank a well-matched peer on its own.
const W = {
  market: 3,
  style: 2,
  strategy: 2,
  experience: 1.5,
  verification: 2,
  activity: 1,
  progress: 1,
}

const VERIFICATION_SCORE: Record<VerificationLevel, number> = {
  broker_connected: 1,
  statement_imported: 0.6,
  self_reported: 0.15,
  verification_pending: 0.3,
  verification_failed: 0,
}

function overlap(a: string[], b: string[]): string[] {
  const set = new Set(a.map((x) => x.toLowerCase()))
  return [...new Set(b.filter((x) => set.has(x.toLowerCase())))]
}

/**
 * Score one candidate. Returns null when there is no meaningful affinity at
 * all — better to show fewer suggestions than irrelevant ones.
 */
export function scoreTrader(viewer: ViewerProfile, c: CandidateTrader): Recommendation | null {
  const reasons: string[] = []
  let score = 0

  const sharedMarkets = overlap(viewer.markets, c.markets)
  if (sharedMarkets.length) {
    score += W.market * Math.min(sharedMarkets.length, 3)
    reasons.push(`Trades ${sharedMarkets.slice(0, 2).join(' & ')}`)
  }

  const sharedStyles = overlap(viewer.styles, c.styles)
  if (sharedStyles.length) {
    score += W.style * Math.min(sharedStyles.length, 2)
    reasons.push(`${sharedStyles[0]} style`)
  }

  const sharedStrategies = overlap(viewer.strategies, c.strategies)
  if (sharedStrategies.length) {
    score += W.strategy * Math.min(sharedStrategies.length, 2)
    reasons.push(`Runs "${sharedStrategies[0]}"`)
  }

  if (viewer.experience && c.experience === viewer.experience) {
    score += W.experience
    reasons.push(`Also ${viewer.experience}`)
  }

  const vScore = VERIFICATION_SCORE[c.verification]
  score += W.verification * vScore
  if (c.verification === 'broker_connected') reasons.push('Broker-verified')
  else if (c.verification === 'statement_imported') reasons.push('Statement-verified')

  // Activity: some evidence they actually trade, with diminishing returns.
  if (c.publicTrades > 0) score += W.activity * Math.min(1, Math.log10(c.publicTrades + 1))

  // Learning progress: similar stage of the journey.
  if (viewer.lessonsCompleted > 0 && c.lessonsCompleted > 0) {
    const gap = Math.abs(viewer.lessonsCompleted - c.lessonsCompleted)
    if (gap <= 3) { score += W.progress; reasons.push('Similar learning progress') }
  }

  // Require at least one real affinity signal (not just verification/activity).
  const hasAffinity = sharedMarkets.length > 0 || sharedStyles.length > 0 ||
    sharedStrategies.length > 0 || (viewer.experience != null && c.experience === viewer.experience)
  if (!hasAffinity) return null

  return {
    userId: c.userId, username: c.username, displayName: c.displayName, avatarUrl: c.avatarUrl,
    score: Math.round(score * 100) / 100,
    reasons: reasons.slice(0, 3),
    verification: c.verification,
  }
}

/** Top-N recommended traders, best first. Excludes already-followed users. */
export function recommendTraders(
  viewer: ViewerProfile,
  candidates: CandidateTrader[],
  opts: { exclude?: Set<string>; limit?: number } = {},
): Recommendation[] {
  const { exclude = new Set(), limit = 5 } = opts
  return candidates
    .filter((c) => !exclude.has(c.userId))
    .map((c) => scoreTrader(viewer, c))
    .filter((r): r is Recommendation => r !== null)
    .sort((a, b) => b.score - a.score || a.username.localeCompare(b.username))
    .slice(0, limit)
}

/**
 * Re-rank fallback feed posts by their author's affinity score. Posts from
 * followed authors are left untouched (handled upstream); this only reorders
 * the discovery portion so it isn't purely chronological.
 */
export function rankFeedByAffinity<T extends { author_id: string; created_at: string }>(
  posts: T[],
  scoreByAuthor: Map<string, number>,
  now: number = Date.now(),
): T[] {
  const DAY = 864e5
  const value = (p: T) => {
    const ageDays = Math.max(0, (now - Date.parse(p.created_at)) / DAY)
    const recency = 1 / (1 + ageDays)          // decays with age
    const affinity = scoreByAuthor.get(p.author_id) ?? 0
    return affinity * 0.6 + recency * 10        // recency still dominates
  }
  return [...posts].sort((a, b) => value(b) - value(a))
}
