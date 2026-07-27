import { splitSymbol } from '@/lib/crypto/symbols'

// Validates a user-entered pair list for the connect form. Pairs are kept in
// EXCHANGE form (BTC/USDT) because that is what CCXT is handed; normalization
// to BTC/USD happens later, only in mapCycleToTrade.
export function validatePairs(raw: string[]): { pairs: string[]; invalid: string[] } {
  const pairs: string[] = []
  const invalid: string[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    const s = entry.trim().toUpperCase()
    if (!s) continue
    if (!splitSymbol(s)) { invalid.push(entry.trim()); continue }
    if (seen.has(s)) continue
    seen.add(s)
    pairs.push(s)
  }
  return { pairs, invalid }
}
