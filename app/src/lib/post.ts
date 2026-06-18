export type PollResult = { id: string; label: string; count: number; pct: number; votedFor: boolean }

export function pollResults(
  options: { id: string; label: string }[],
  votes: { option_id: string }[],
  myVote: string | null,
): { results: PollResult[]; total: number } {
  const total = votes.length
  const counts: Record<string, number> = {}
  for (const v of votes) counts[v.option_id] = (counts[v.option_id] ?? 0) + 1
  const results = options.map((o) => {
    const count = counts[o.id] ?? 0
    return { id: o.id, label: o.label, count, pct: total ? Math.round((count / total) * 100) : 0, votedFor: myVote === o.id }
  })
  return { results, total }
}

export function rrBar(entry: number, stop: number, target: number | null, direction: 'long' | 'short') {
  const prices = target != null ? [entry, stop, target] : [entry, stop]
  const min = Math.min(...prices), max = Math.max(...prices)
  const span = max - min || 1
  const norm = (p: number) => (p - min) / span
  const orient = (n: number) => (direction === 'long' ? n : 1 - n)
  return {
    entryPos: orient(norm(entry)),
    stopPos: orient(norm(stop)),
    targetPos: target != null ? orient(norm(target)) : null,
  }
}
