import { pipInfo } from '@/lib/instruments'
import { normalizeExchangeSymbol } from '@/lib/crypto/symbols'
import type { Cycle } from '@/lib/crypto/fills'

// Mirrors mapDealToTrade (lib/mt5.ts) so crypto and MT5 rows are the same
// shape. source stays 'broker': an API-sourced fill carries the same trust
// level as a MetaApi sync, so verification badges need no new case.
export function mapCycleToTrade(
  cycle: Cycle,
  opts: { userId: string; isPublic: boolean },
): Record<string, unknown> {
  const { instrument, market } = normalizeExchangeSymbol(cycle.symbol)
  const { pipSize } = pipInfo(instrument, market)
  const dirSign = cycle.direction === 'long' ? 1 : -1
  const realizedPips = ((cycle.exitPrice - cycle.entryPrice) * dirSign) / pipSize
  const pnl = Math.round(cycle.pnl * 100) / 100

  return {
    user_id: opts.userId,
    broker_deal_id: cycle.dedupeId,
    source: 'broker',
    market,
    instrument,
    direction: cycle.direction,
    sizing_mode: 'lots',
    lots: cycle.size,
    risk_percent: null,
    entry_price: cycle.entryPrice,
    exit_price: cycle.exitPrice,
    // Exchange fills carry no stop, so R-based stats exclude these rows —
    // same behaviour as MT5 statement imports.
    stop_price: null,
    target_price: null,
    risk_amount: 0,
    sl_pips: 0,
    tp_pips: null,
    planned_rr: null,
    r_multiple: null,
    pnl_amount: pnl,
    realized_pips: Math.round(realizedPips * 10) / 10,
    outcome: pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven',
    status: 'closed',
    is_public: opts.isPublic,
    traded_at: cycle.openedAt,
    closed_at: cycle.closedAt,
  }
}
