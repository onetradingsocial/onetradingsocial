// Exchange symbols come in two shapes: the CCXT unified form ('BTC/USDT',
// futures 'BTC/USDT:USDT') and the raw exchange form ('BTCUSDT'). Stablecoin
// quotes all collapse to USD so one asset is one journal instrument — without
// this, BTC/USDT and BTC/USDC fragment every breakdown and leaderboard.
export const STABLE_QUOTES = ['USDT', 'USDC', 'BUSD', 'FDUSD', 'TUSD', 'DAI'] as const

const KNOWN_QUOTES: readonly string[] = [...STABLE_QUOTES, 'USD', 'BTC', 'ETH', 'BNB', 'EUR', 'GBP']

export function normalizeCurrency(ccy: string): string {
  const c = ccy.trim().toUpperCase()
  return (STABLE_QUOTES as readonly string[]).includes(c) ? 'USD' : c
}

export function splitSymbol(raw: string): { base: string; quote: string } | null {
  const s = raw.trim().toUpperCase()
  if (!s) return null
  const slash = s.indexOf('/')
  if (slash > 0) {
    const quote = s.slice(slash + 1).split(':')[0]
    return quote ? { base: s.slice(0, slash), quote } : null
  }
  const quote = KNOWN_QUOTES
    .filter((k) => s.endsWith(k) && s.length > k.length)
    .sort((a, b) => b.length - a.length)[0]
  return quote ? { base: s.slice(0, s.length - quote.length), quote } : null
}

export function quoteCurrency(raw: string): string {
  return splitSymbol(raw)?.quote ?? ''
}

export type NormalizedSymbol = { instrument: string; market: 'crypto' }

export function normalizeExchangeSymbol(raw: string): NormalizedSymbol {
  const parts = splitSymbol(raw)
  if (!parts) return { instrument: raw.trim().toUpperCase(), market: 'crypto' }
  return { instrument: `${parts.base}/${normalizeCurrency(parts.quote)}`, market: 'crypto' }
}
