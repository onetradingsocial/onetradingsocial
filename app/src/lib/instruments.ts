export type Instrument = {
  symbol: string
  name: string
  market: 'forex' | 'crypto' | 'stocks' | 'indices' | 'commodities'
  pipSize: number
  pipValuePerLot: number // USD per pip per 1 standard lot (static, approximate)
}

// Static MVP catalog. pipValuePerLot assumes a USD account; values are
// representative, not live-quoted. Custom instruments fall back to inference.
export const INSTRUMENTS: Instrument[] = [
  { symbol: 'EUR/USD', name: 'Euro / US Dollar', market: 'forex', pipSize: 0.0001, pipValuePerLot: 10 },
  { symbol: 'GBP/USD', name: 'Pound / US Dollar', market: 'forex', pipSize: 0.0001, pipValuePerLot: 10 },
  { symbol: 'AUD/USD', name: 'Aussie / US Dollar', market: 'forex', pipSize: 0.0001, pipValuePerLot: 10 },
  { symbol: 'NZD/USD', name: 'Kiwi / US Dollar', market: 'forex', pipSize: 0.0001, pipValuePerLot: 10 },
  { symbol: 'USD/JPY', name: 'US Dollar / Yen', market: 'forex', pipSize: 0.01, pipValuePerLot: 9 },
  { symbol: 'USD/CHF', name: 'US Dollar / Franc', market: 'forex', pipSize: 0.0001, pipValuePerLot: 11 },
  { symbol: 'USD/CAD', name: 'US Dollar / Loonie', market: 'forex', pipSize: 0.0001, pipValuePerLot: 7.5 },
  { symbol: 'EUR/JPY', name: 'Euro / Yen', market: 'forex', pipSize: 0.01, pipValuePerLot: 9 },
  { symbol: 'GBP/JPY', name: 'Pound / Yen', market: 'forex', pipSize: 0.01, pipValuePerLot: 9 },
  { symbol: 'XAU/USD', name: 'Gold / US Dollar', market: 'commodities', pipSize: 0.1, pipValuePerLot: 10 },
  { symbol: 'BTC/USD', name: 'Bitcoin / US Dollar', market: 'crypto', pipSize: 1, pipValuePerLot: 1 },
  { symbol: 'ETH/USD', name: 'Ethereum / US Dollar', market: 'crypto', pipSize: 0.1, pipValuePerLot: 1 },
  { symbol: 'US30', name: 'Dow Jones 30', market: 'indices', pipSize: 1, pipValuePerLot: 1 },
  { symbol: 'NAS100', name: 'Nasdaq 100', market: 'indices', pipSize: 1, pipValuePerLot: 1 },
  { symbol: 'SPX500', name: 'S&P 500', market: 'indices', pipSize: 0.1, pipValuePerLot: 1 },
  { symbol: 'GER40', name: 'DAX 40', market: 'indices', pipSize: 1, pipValuePerLot: 1 },
]

export function findInstrument(symbol: string): Instrument | undefined {
  const s = symbol.trim().toUpperCase()
  return INSTRUMENTS.find((i) => i.symbol === s)
}

export type PipInfo = { pipSize: number; pipValuePerLot: number | null }

export function pipInfo(symbol: string, market: string): PipInfo {
  const found = findInstrument(symbol)
  if (found) return { pipSize: found.pipSize, pipValuePerLot: found.pipValuePerLot }
  // Inference for custom instruments
  if (market === 'forex') {
    const isJpy = symbol.trim().toUpperCase().includes('JPY')
    return { pipSize: isJpy ? 0.01 : 0.0001, pipValuePerLot: null }
  }
  return { pipSize: 1, pipValuePerLot: null }
}
