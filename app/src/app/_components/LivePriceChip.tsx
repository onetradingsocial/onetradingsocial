'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type Quote = { symbol: string; price: number; at: number; proxy?: string }

function fmt(price: number): string {
  if (price >= 1000) return price.toFixed(2)
  if (price >= 10) return price.toFixed(3)
  return price.toFixed(5)
}

export function LivePriceChip({ symbol, onUse }: { symbol: string; onUse: (price: string) => void }) {
  const [quote, setQuote] = useState<Quote | null>(null)
  const [loading, setLoading] = useState(false)
  const seq = useRef(0)

  const load = useCallback(async () => {
    const s = symbol.trim().toUpperCase()
    const id = ++seq.current
    if (!s) { setQuote(null); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/market/quote?symbol=${encodeURIComponent(s)}`)
      const json = res.ok ? ((await res.json()) as { quote?: Quote }) : null
      if (id !== seq.current) return
      setQuote(json?.quote && Number.isFinite(json.quote.price) ? json.quote : null)
    } catch {
      if (id === seq.current) setQuote(null)
    } finally {
      if (id === seq.current) setLoading(false)
    }
  }, [symbol])

  // Debounce: waits out fast symbol changes (typing) before spending a quote credit.
  useEffect(() => {
    const t = setTimeout(load, 500)
    return () => clearTimeout(t)
  }, [load])

  if (!quote) return null
  return (
    <span className="ts-pricechip">
      <span className="ts-pricechip-dot" data-loading={loading} />
      <span className="ts-pricechip-val">{fmt(quote.price)}</span>
      {quote.proxy && <span className="ts-pricechip-proxy">via {quote.proxy}</span>}
      {!quote.proxy && (
        <button type="button" className="ts-pricechip-use" onClick={() => onUse(String(quote.price))}>
          Use
        </button>
      )}
      <button type="button" className="ts-pricechip-refresh" onClick={load} title="Refresh price">↻</button>
    </span>
  )
}
