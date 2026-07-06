// Pairs raw MetaApi history deals into Phase 1's Mt5Deal shape.
// Pure module: no server deps; unit-tested with MetaApi-shaped fixtures.
import type { Mt5Deal } from '@/lib/mt5'

export type MetaApiDeal = {
  id: string
  type: string
  entryType?: string
  symbol?: string
  positionId?: string
  volume?: number
  price?: number
  time: string
  profit?: number
  commission?: number
  swap?: number
  stopLoss?: number
  takeProfit?: number
}

const r2 = (n: number) => Math.round(n * 100) / 100

function toZ(t: string): string {
  const d = new Date(t)
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

type Position = {
  symbol: string
  direction: 'long' | 'short'
  inVolume: number
  inNotional: number     // Σ volume × price, for weighted avg entry
  inCommission: number
  firstInTime: string
}

/** Groups deals by positionId; each OUT (or INOUT) emits one closed Mt5Deal. */
export function pairDealsToTrades(deals: MetaApiDeal[]): { trades: Mt5Deal[]; maxDealTime: string | null } {
  const positions = new Map<string, Position>()
  const trades: Mt5Deal[] = []
  let maxTime: string | null = null

  const rank = (d: MetaApiDeal) => (d.entryType === 'DEAL_ENTRY_IN' ? 0 : 1)
  const sorted = [...deals].sort((a, b) => a.time.localeCompare(b.time) || rank(a) - rank(b))
  for (const d of sorted) {
    if (!maxTime || d.time > maxTime) maxTime = d.time

    if (!d.positionId || !d.symbol || d.volume == null || d.price == null) continue
    const isIn = d.entryType === 'DEAL_ENTRY_IN'
    const isOut = d.entryType === 'DEAL_ENTRY_OUT' || d.entryType === 'DEAL_ENTRY_INOUT'
    if (!isIn && !isOut) continue

    if (isIn) {
      const pos = positions.get(d.positionId)
      if (pos) {
        pos.inVolume += d.volume
        pos.inNotional += d.volume * d.price
        pos.inCommission += d.commission ?? 0
      } else {
        positions.set(d.positionId, {
          symbol: d.symbol,
          direction: d.type === 'DEAL_TYPE_BUY' ? 'long' : 'short',
          inVolume: d.volume,
          inNotional: d.volume * d.price,
          inCommission: d.commission ?? 0,
          firstInTime: d.time,
        })
      }
      continue
    }

    const pos = positions.get(d.positionId)
    if (!pos || pos.inVolume <= 0) continue // opened before window; cursor makes this rare

    const share = Math.min(d.volume / pos.inVolume, 1)
    const commission = r2((d.commission ?? 0) + pos.inCommission * share)
    const profit = d.profit ?? 0
    const swap = d.swap ?? 0
    trades.push({
      ticket: d.id,
      symbol: pos.symbol,
      direction: pos.direction,
      lots: d.volume,
      openTime: toZ(pos.firstInTime),
      closeTime: toZ(d.time),
      openPrice: pos.inNotional / pos.inVolume,
      closePrice: d.price,
      stopPrice: d.stopLoss ?? null,
      targetPrice: d.takeProfit ?? null,
      commission,
      swap,
      profit,
      netPnl: r2(profit + commission + swap),
    })
  }

  return { trades, maxDealTime: maxTime ? toZ(maxTime) : null }
}
