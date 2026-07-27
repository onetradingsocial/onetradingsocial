import 'server-only'
import { binance } from 'ccxt'
import type { Fill } from '@/lib/crypto/fills'

// The only module that imports CCXT. Wraps one Binance spot client behind
// two operations the sync needs: a read-only scope check and a fills fetch.
// Functions take an optional client so they unit-test without network.
export type ExchangeCreds = { apiKey: string; apiSecret: string }

export type BinanceClient = {
  fetchMyTrades: (symbol: string, since?: number, limit?: number, params?: object) => Promise<unknown[]>
  sapiGetAccountApiRestrictions: () => Promise<Record<string, unknown>>
}

export function makeClient(creds: ExchangeCreds): BinanceClient {
  return new binance({
    apiKey: creds.apiKey,
    secret: creds.apiSecret,
    enableRateLimit: true,
  }) as unknown as BinanceClient
}

// Reject any key that can move funds or trade. A read key is the only kind
// we will custody. Never echoes the key on failure.
export async function verifyReadOnly(
  creds: ExchangeCreds,
  client: BinanceClient = makeClient(creds),
): Promise<{ ok: true } | { ok: false; reason: string }> {
  let r: Record<string, unknown>
  try {
    r = await client.sapiGetAccountApiRestrictions()
  } catch {
    return { ok: false, reason: 'Could not reach Binance with that key — check it is correct and read-only.' }
  }
  if (r.enableWithdrawals === true) {
    return { ok: false, reason: 'This key can withdraw funds. Create a new key with only "Enable Reading" checked.' }
  }
  if (r.enableSpotAndMarginTrading === true || r.enableMargin === true || r.enableFutures === true) {
    return { ok: false, reason: 'This key can place trades. Create a new key with only "Enable Reading" checked.' }
  }
  return { ok: true }
}

const PAGE_LIMIT = 1000
// Floor for the first-ever sync: pull at most ~1 year of history per pair.
const BACKFILL_FLOOR_MS = 365 * 24 * 60 * 60 * 1000

type CcxtTrade = {
  id: string; timestamp: number; symbol: string; side: 'buy' | 'sell'
  price: number; amount: number; fee?: { cost: number; currency: string } | null
}

function toFill(t: CcxtTrade): Fill {
  return {
    id: String(t.id),
    symbol: t.symbol,
    timestamp: t.timestamp,
    side: t.side,
    price: t.price,
    amount: t.amount,
    fee: t.fee ?? null,
  }
}

// One pair's fills, paged forward from the cursor. Binance myTrades is
// per-symbol and time-windowed; we walk pages until one comes back empty or
// stops making forward progress, guarding against an infinite loop. We don't
// treat a page shorter than PAGE_LIMIT as end-of-data — Binance can return a
// partial page mid-history — so we always confirm the end with one empty call.
export async function fetchFillsSince(
  creds: ExchangeCreds,
  symbol: string,
  sinceMs: number | null,
  client: BinanceClient = makeClient(creds),
): Promise<Fill[]> {
  let since = sinceMs ?? Date.now() - BACKFILL_FLOOR_MS
  const out: Fill[] = []
  const seen = new Set<string>()
  for (;;) {
    const page = (await client.fetchMyTrades(symbol, since, PAGE_LIMIT)) as CcxtTrade[]
    if (!page || page.length === 0) break
    let progressed = false
    for (const t of page) {
      const f = toFill(t)
      if (seen.has(f.id)) continue
      seen.add(f.id)
      out.push(f)
      progressed = true
      if (f.timestamp >= since) since = f.timestamp + 1 // advance the window past this fill
    }
    if (!progressed) break
  }
  return out
}
