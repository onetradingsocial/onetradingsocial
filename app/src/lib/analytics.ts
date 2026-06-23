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
