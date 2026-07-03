export function assembleFeed<T extends { id: string }>(primary: T[], fallback: T[], limit: number): T[] {
  const seen = new Set(primary.map((p) => p.id))
  const merged: T[] = [...primary]
  for (const f of fallback) {
    if (merged.length >= limit) break
    if (!seen.has(f.id)) { seen.add(f.id); merged.push(f) }
  }
  return merged.slice(0, limit)
}

export function tally<K extends string>(rows: Array<Record<K, string>> | null | undefined, key: K): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows ?? []) out[r[key]] = (out[r[key]] ?? 0) + 1
  return out
}

const BOOST_WINDOW_MS = 48 * 60 * 60 * 1000

// Two-band sort: favourited authors' posts from the last 48h first (newest
// first), then everything else in its existing order.
export function boostFavorites<T extends { author_id: string; created_at: string }>(
  posts: T[], favoriteIds: Set<string>, now: number = Date.now(),
): T[] {
  if (favoriteIds.size === 0) return posts
  const boosted: T[] = [], rest: T[] = []
  for (const p of posts) {
    const fresh = now - Date.parse(p.created_at) <= BOOST_WINDOW_MS
    if (favoriteIds.has(p.author_id) && fresh) boosted.push(p)
    else rest.push(p)
  }
  boosted.sort((a, b) => b.created_at.localeCompare(a.created_at))
  return [...boosted, ...rest]
}
