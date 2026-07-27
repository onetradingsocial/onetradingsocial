import 'server-only'
import { binance } from 'ccxt'

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
