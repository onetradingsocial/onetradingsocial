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
