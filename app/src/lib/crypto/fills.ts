import { quoteCurrency, normalizeCurrency } from '@/lib/crypto/symbols'

// Exchanges return individual fills, not trades: one position may be a dozen
// fills. Roll them into round trips (open -> flat) so the journal's win rate,
// expectancy and streaks stay meaningful. Only completed cycles are emitted —
// a position still open when the batch ends is picked up by a later sync, so
// no row ever has to mutate and the dedupe key stays immutable.
export type Fill = {
  id: string
  symbol: string
  timestamp: number // ms
  side: 'buy' | 'sell'
  price: number
  amount: number // base qty
  fee?: { cost: number; currency: string } | null
}

export type Cycle = {
  dedupeId: string // id of the fill that flattened the position
  symbol: string
  direction: 'long' | 'short'
  size: number
  entryPrice: number
  exitPrice: number
  fees: number
  pnl: number
  openedAt: string // ISO
  closedAt: string
}

export type RollupResult = { cycles: Cycle[]; skippedOpen: number; warnings: string[] }

// Exchanges return dust remainders; exact-zero comparison would leak cycles.
const EPS = 1e-8

const iso = (ms: number) => new Date(ms).toISOString()

export function rollupFills(fills: Fill[]): RollupResult {
  const cycles: Cycle[] = []
  const warnings: string[] = []
  let skippedOpen = 0

  const bySymbol = new Map<string, Fill[]>()
  for (const fill of fills) {
    const list = bySymbol.get(fill.symbol)
    if (list) list.push(fill)
    else bySymbol.set(fill.symbol, [fill])
  }

  for (const [symbol, list] of bySymbol) {
    const quote = normalizeCurrency(quoteCurrency(symbol))
    const sorted = [...list].sort(
      (a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id, undefined, { numeric: true }),
    )

    let net = 0
    let dir: 1 | -1 | 0 = 0
    let entryQty = 0, entryNotional = 0
    let exitQty = 0, exitNotional = 0
    let fees = 0
    let openedAt = 0

    for (const fill of sorted) {
      const sign = fill.side === 'buy' ? 1 : -1

      // Fee is only netted when it was charged in the pair's quote currency —
      // a BNB-denominated fee would need a rate we do not have here.
      let feePerUnit = 0
      if (fill.fee && fill.fee.cost !== 0) {
        if (quote && normalizeCurrency(fill.fee.currency) === quote && fill.amount > 0) {
          feePerUnit = fill.fee.cost / fill.amount
        } else {
          warnings.push(
            `${symbol} fill ${fill.id}: fee in ${fill.fee.currency.toUpperCase()} excluded from P&L`,
          )
        }
      }

      let remaining = fill.amount
      while (remaining > EPS) {
        if (dir === 0) {
          dir = sign
          openedAt = fill.timestamp
        }
        const closing = sign === -dir
        const qty = closing ? Math.min(remaining, Math.abs(net)) : remaining

        if (closing) {
          exitQty += qty
          exitNotional += qty * fill.price
        } else {
          entryQty += qty
          entryNotional += qty * fill.price
        }
        fees += qty * feePerUnit
        net += sign * qty
        remaining -= qty

        if (Math.abs(net) <= EPS) {
          const entryPrice = entryNotional / entryQty
          const exitPrice = exitNotional / exitQty
          const size = exitQty
          cycles.push({
            dedupeId: fill.id,
            symbol,
            direction: dir === 1 ? 'long' : 'short',
            size,
            entryPrice,
            exitPrice,
            fees,
            pnl: (exitPrice - entryPrice) * dir * size - fees,
            openedAt: iso(openedAt),
            closedAt: iso(fill.timestamp),
          })
          net = 0
          dir = 0
          entryQty = 0; entryNotional = 0
          exitQty = 0; exitNotional = 0
          fees = 0
        }
      }
    }

    if (dir !== 0) skippedOpen += 1
  }

  return { cycles, skippedOpen, warnings }
}
