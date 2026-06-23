export type DatedRow = { createdAt: string; userId?: string }
export type WeekBucket = { weekStart: string; count: number }

const DAY = 864e5

export function daysAgo(now: Date, n: number): Date {
  return new Date(now.getTime() - n * DAY)
}

// UTC Monday 00:00 of the week containing d.
export function weekStart(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dow = (x.getUTCDay() + 6) % 7 // 0 = Monday
  x.setUTCDate(x.getUTCDate() - dow)
  return x
}

// n Monday boundaries, ascending, last = current week.
export function lastNWeeks(now: Date, n: number): Date[] {
  const cur = weekStart(now)
  const out: Date[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(cur)
    d.setUTCDate(d.getUTCDate() - i * 7)
    out.push(d)
  }
  return out
}

export function bucketByWeek(rows: DatedRow[], now: Date, n = 12): WeekBucket[] {
  const weeks = lastNWeeks(now, n)
  const counts = new Array(n).fill(0)
  const firstMs = weeks[0].getTime()
  for (const r of rows) {
    const t = new Date(r.createdAt).getTime()
    if (Number.isNaN(t) || t < firstMs) continue
    const ws = weekStart(new Date(t)).getTime()
    const idx = weeks.findIndex((w) => w.getTime() === ws)
    if (idx >= 0) counts[idx] += 1
  }
  return weeks.map((w, i) => ({ weekStart: w.toISOString().slice(0, 10), count: counts[i] }))
}

export function countSince(rows: DatedRow[], since: Date): number {
  const s = since.getTime()
  let c = 0
  for (const r of rows) {
    const t = new Date(r.createdAt).getTime()
    if (!Number.isNaN(t) && t >= s) c += 1
  }
  return c
}

export function distinctActiveUsers(rowSets: DatedRow[][], since: Date): number {
  const s = since.getTime()
  const set = new Set<string>()
  for (const rows of rowSets) {
    for (const r of rows) {
      if (!r.userId) continue
      const t = new Date(r.createdAt).getTime()
      if (!Number.isNaN(t) && t >= s) set.add(r.userId)
    }
  }
  return set.size
}

export function topCourseCompletions(
  rows: { courseTitle: string }[],
  limit = 5,
): { courseTitle: string; count: number }[] {
  const m = new Map<string, number>()
  for (const r of rows) m.set(r.courseTitle, (m.get(r.courseTitle) ?? 0) + 1)
  return [...m.entries()]
    .map(([courseTitle, count]) => ({ courseTitle, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

export type AnalyticsInput = {
  profiles: DatedRow[]
  trades: DatedRow[]
  closedPublicTrades: DatedRow[]
  posts: DatedRow[]
  comments: DatedRow[]
  likes: DatedRow[]
  completions: DatedRow[]
  completionsByCourse: { courseTitle: string }[]
  publishedLessons: number
  feedback: { createdAt: string; status: string }[]
}

export type AnalyticsDashboard = {
  growth: { totalUsers: number; new7d: number; new30d: number; signupsPerWeek: WeekBucket[] }
  engagement: {
    active7d: number; active30d: number; totalTrades: number
    tradesPerWeek: WeekBucket[]; postsPerWeek: WeekBucket[]; socialPerWeek: WeekBucket[]
  }
  content: {
    totalCompletions: number; completionsPerWeek: WeekBucket[]
    topCourses: { courseTitle: string; count: number }[]
    publishedLessons: number; leaderboardParticipants: number
  }
  ops: { totalFeedback: number; openFeedback: number; triagedFeedback: number; closedFeedback: number; feedbackPerWeek: WeekBucket[] }
}

export function buildDashboard(input: AnalyticsInput, now: Date): AnalyticsDashboard {
  const d7 = daysAgo(now, 7)
  const d30 = daysAgo(now, 30)
  const activitySets = [input.trades, input.posts, input.comments, input.likes, input.completions]
  const social = [...input.likes, ...input.comments]
  const openFeedback = input.feedback.filter((f) => f.status === 'open').length
  const triagedFeedback = input.feedback.filter((f) => f.status === 'triaged').length
  const closedFeedback = input.feedback.filter((f) => f.status === 'closed').length
  return {
    growth: {
      totalUsers: input.profiles.length,
      new7d: countSince(input.profiles, d7),
      new30d: countSince(input.profiles, d30),
      signupsPerWeek: bucketByWeek(input.profiles, now),
    },
    engagement: {
      active7d: distinctActiveUsers(activitySets, d7),
      active30d: distinctActiveUsers(activitySets, d30),
      totalTrades: input.trades.length,
      tradesPerWeek: bucketByWeek(input.trades, now),
      postsPerWeek: bucketByWeek(input.posts, now),
      socialPerWeek: bucketByWeek(social, now),
    },
    content: {
      totalCompletions: input.completions.length,
      completionsPerWeek: bucketByWeek(input.completions, now),
      topCourses: topCourseCompletions(input.completionsByCourse),
      publishedLessons: input.publishedLessons,
      leaderboardParticipants: new Set(
        input.closedPublicTrades.map((t) => t.userId).filter((u): u is string => !!u),
      ).size,
    },
    ops: {
      totalFeedback: input.feedback.length,
      openFeedback,
      triagedFeedback,
      closedFeedback,
      feedbackPerWeek: bucketByWeek(input.feedback.map((f) => ({ createdAt: f.createdAt })), now),
    },
  }
}
