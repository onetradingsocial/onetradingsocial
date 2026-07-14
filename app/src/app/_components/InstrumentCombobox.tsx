'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { INSTRUMENTS } from '@/lib/instruments'
import type { MarketSearchResult } from '@/lib/market-data'

function staticHits(q: string): MarketSearchResult[] {
  const s = q.trim().toUpperCase()
  return INSTRUMENTS
    .filter((i) => !s || i.symbol.toUpperCase().includes(s) || i.name.toUpperCase().includes(s))
    .map((i) => ({ symbol: i.symbol, name: i.name, market: i.market }))
}

export function InstrumentCombobox({ value, onChange, onSelect }: {
  value: string
  onChange: (v: string) => void
  onSelect: (r: MarketSearchResult) => void
}) {
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<MarketSearchResult[]>([])
  const [active, setActive] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seq = useRef(0)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const query = useCallback((q: string) => {
    if (timer.current) clearTimeout(timer.current)
    setResults(staticHits(q))
    setActive(0)
    if (q.trim().length < 2) return
    timer.current = setTimeout(async () => {
      const id = ++seq.current
      try {
        const res = await fetch(`/api/market/search?q=${encodeURIComponent(q.trim())}`)
        if (!res.ok) return
        const json = (await res.json()) as { results?: MarketSearchResult[] }
        if (id === seq.current && Array.isArray(json.results) && json.results.length) {
          setResults(json.results)
          setActive(0)
        }
      } catch { /* keep static results */ }
    }, 300)
  }, [])

  function pick(r: MarketSearchResult) {
    onSelect(r)
    setOpen(false)
  }

  return (
    <div className="ts-combobox">
      <input
        name="instrument"
        className="ts-input"
        value={value}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        onFocus={() => { setOpen(true); query(value) }}
        onBlur={() => setOpen(false)}
        onChange={(e) => { onChange(e.target.value); setOpen(true); query(e.target.value) }}
        onKeyDown={(e) => {
          if (!open || !results.length) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
          else if (e.key === 'Enter') { e.preventDefault(); pick(results[active]) }
          else if (e.key === 'Escape') setOpen(false)
        }}
      />
      {open && results.length > 0 && (
        <ul className="ts-combobox-list" role="listbox">
          {results.map((r, i) => (
            <li
              key={`${r.symbol}-${r.exchange ?? ''}`}
              role="option"
              aria-selected={i === active}
              data-active={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(r) }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="ts-combobox-sym">{r.symbol}</span>
              <span className="ts-combobox-name">{r.name}</span>
              <span className="ts-combobox-badge" data-market={r.market}>{r.market}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
