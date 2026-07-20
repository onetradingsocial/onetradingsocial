import { MISTAKE_TAGS } from '@/lib/trade'

export type MistakeTrade = {
  mistake_tags: string[] | null
  pnl_amount: number | null
  r_multiple: number | null
  traded_at: string
}

function money(n: number) {
  const a = `$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  return n < 0 ? `−${a}` : a
}

/**
 * Mistake tracking analysis (Sprint 3, row 20). Per-tag frequency, estimated
 * cost, win rate when present, and trend (this half vs previous half of the
 * dated history). Tags are captured on trade close (Trader+).
 */
export function MistakeAnalysisCard({ trades, locked }: { trades: MistakeTrade[]; locked: boolean }) {
  // Locked cards render nothing — LockedFeatures lists them once at the page foot.
  if (locked) return null

  const closed = trades.filter((t) => t.r_multiple != null)
  const tagged = closed.filter((t) => (t.mistake_tags ?? []).length > 0)
  const EPS = 1e-9

  // Split chronologically for a simple trend read.
  const asc = [...closed].sort((a, b) => a.traded_at.localeCompare(b.traded_at))
  const mid = Math.floor(asc.length / 2)
  const firstHalf = new Set(asc.slice(0, mid).map((t) => t.traded_at))

  type Row = { tag: string; count: number; cost: number; wins: number; recent: number; older: number }
  const rows = new Map<string, Row>()
  for (const t of closed) {
    for (const tag of t.mistake_tags ?? []) {
      const r = rows.get(tag) ?? { tag, count: 0, cost: 0, wins: 0, recent: 0, older: 0 }
      r.count++
      r.cost += (t.pnl_amount ?? 0) < 0 ? (t.pnl_amount ?? 0) : 0
      if ((t.r_multiple ?? 0) > EPS) r.wins++
      if (firstHalf.has(t.traded_at)) r.older++
      else r.recent++
      rows.set(tag, r)
    }
  }

  const ranked = [...rows.values()].sort((a, b) => a.cost - b.cost) // most costly (most negative) first

  if (tagged.length === 0) {
    return (
      <div className="ts-card">
        <h2 className="ts-h2">Mistake analysis</h2>
        <p className="faint mt-3" style={{ fontSize: 13 }}>
          No mistakes tagged yet. When you close a trade, flag any mistakes ({MISTAKE_TAGS.slice(0, 3).join(', ')}…) to see patterns here.
        </p>
      </div>
    )
  }

  const totalCost = ranked.reduce((s, r) => s + r.cost, 0)

  return (
    <div className="ts-card">
      <div className="flex items-center justify-between">
        <h2 className="ts-h2">Mistake analysis</h2>
        <span className="faint" style={{ fontSize: 12 }}>{tagged.length} of {closed.length} trades tagged</span>
      </div>

      <div className="ts-banner mt-3" style={{ background: 'var(--down-soft)', borderColor: 'rgba(229,71,93,0.3)' }}>
        <span>Tagged mistakes have cost you <b>{money(totalCost)}</b> in losing trades.</span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="ts-table mt-3">
          <thead><tr><th>Mistake</th><th className="num">Times</th><th className="num">Est. cost</th><th className="num">Win rate</th><th className="num">Trend</th></tr></thead>
          <tbody>
            {ranked.map((r) => {
              const trend = r.recent - r.older
              return (
                <tr key={r.tag}>
                  <td>{r.tag}</td>
                  <td className="num">{r.count}</td>
                  <td className="num ts-neg">{money(r.cost)}</td>
                  <td className="num">{Math.round((r.wins / r.count) * 100)}%</td>
                  <td className="num">
                    {trend > 0 ? <span className="ts-neg">▲ rising</span> : trend < 0 ? <span className="ts-pos">▼ falling</span> : <span className="faint">flat</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
