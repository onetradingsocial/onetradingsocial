'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { createTrade, saveTradeChartUrl } from '@/app/actions/trade'
import { computeOpen, MISTAKE_TAGS, SETUP_PRESETS, type Direction, type SizingMode } from '@/lib/trade'
import { INSTRUMENTS, pipInfo } from '@/lib/instruments'

const MARKETS = ['forex', 'crypto', 'stocks', 'indices', 'commodities'] as const
const BUCKET = process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'OneTradingSocial'

export function TradeCaptureModal({ defaultPublic, accountBalance }: { defaultPublic: boolean; accountBalance: number }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  const [market, setMarket] = useState<string>('forex')
  const [instrument, setInstrument] = useState('EUR/USD')
  const [direction, setDirection] = useState<Direction>('long')
  const [sizingMode, setSizingMode] = useState<SizingMode>('risk_percent')
  const [entry, setEntry] = useState('')
  const [stop, setStop] = useState('')
  const [target, setTarget] = useState('')
  const [exit, setExit] = useState('')
  const [riskPercent, setRiskPercent] = useState('1')
  const [lots, setLots] = useState('1')
  const [mistakes, setMistakes] = useState<string[]>([])
  const [chart, setChart] = useState<File | null>(null)

  const preview = useMemo(() => {
    const e = Number(entry), s = Number(stop), t = target ? Number(target) : null
    if (!entry || !stop || !Number.isFinite(e) || !Number.isFinite(s)) return null
    const { pipSize, pipValuePerLot } = pipInfo(instrument, market)
    const r = computeOpen({
      direction, entry: e, stop: s, target: t, pipSize, sizingMode,
      riskPercent: Number(riskPercent) || 0, lots: Number(lots) || 0,
      accountBalance, pipValuePerLot,
    })
    return 'error' in r ? null : r
  }, [entry, stop, target, instrument, market, direction, sizingMode, riskPercent, lots, accountBalance])

  function toggleMistake(tag: string) {
    setMistakes((m) => m.includes(tag) ? m.filter((x) => x !== tag) : [...m, tag])
  }

  async function onSubmit(formData: FormData) {
    setPending(true); setError('')
    const res = await createTrade({}, formData)
    if (res.error) { setError(res.error); setPending(false); return }

    if (chart && res.tradeId) {
      const ct = chart.type === 'image/png' ? 'image/png' : 'image/jpeg'
      const supabase = createClient()
      // Reuse trade chart signed upload via a tiny fetch to the action is not available client-side;
      // upload through storage signed URL requested from a server action:
      const signed = await fetch(`/app/api/trade-chart-url?tradeId=${res.tradeId}&ct=${encodeURIComponent(ct)}`).then((r) => r.json())
      if (signed?.path && signed?.token) {
        await supabase.storage.from(BUCKET).uploadToSignedUrl(signed.path, signed.token, chart, { upsert: true })
        await saveTradeChartUrl(res.tradeId, signed.publicUrl)
      }
    }
    setPending(false); setOpen(false); router.refresh()
  }

  return (
    <>
      <button className="btn btn-primary" onClick={() => setOpen(true)}>+ Log trade</button>
      {!open ? null : (
        <div className="ts-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}>
          <form action={onSubmit} className="ts-modal">
            <div className="ts-modal-head">
              <div>
                <h2 className="ts-h2">Quick Trade Capture</h2>
                <p className="ts-sub">Log your trade in seconds. Stay consistent.</p>
              </div>
              <button type="button" className="ts-modal-close" onClick={() => setOpen(false)}>✕</button>
            </div>

            <div className="ts-grid2">
              <label className="ts-field"><span className="ts-label">Market</span>
                <select name="market" className="ts-select" value={market} onChange={(e) => setMarket(e.target.value)}>
                  {MARKETS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <label className="ts-field"><span className="ts-label">Instrument</span>
                <input name="instrument" className="ts-input" value={instrument} list="instlist"
                  onChange={(e) => setInstrument(e.target.value)} />
                <datalist id="instlist">{INSTRUMENTS.map((i) => <option key={i.symbol} value={i.symbol}>{i.name}</option>)}</datalist>
              </label>
            </div>

            <input type="hidden" name="direction" value={direction} />
            <input type="hidden" name="sizing_mode" value={sizingMode} />

            <div className="ts-grid2 mt-3.5">
              <div className="ts-field"><span className="ts-label">Direction</span>
                <div className="ts-seg">
                  <label data-x><input type="radio" checked={direction === 'long'} onChange={() => setDirection('long')} /> Buy</label>
                  <label><input type="radio" checked={direction === 'short'} onChange={() => setDirection('short')} /> Sell</label>
                </div>
              </div>
              <div className="ts-field"><span className="ts-label">Sizing</span>
                <div className="ts-seg">
                  <label><input type="radio" checked={sizingMode === 'risk_percent'} onChange={() => setSizingMode('risk_percent')} /> Risk %</label>
                  <label><input type="radio" checked={sizingMode === 'lots'} onChange={() => setSizingMode('lots')} /> Lot Size</label>
                </div>
              </div>
            </div>

            <div className="ts-grid2 mt-3.5">
              <label className="ts-field"><span className="ts-label">Entry price</span>
                <input name="entry_price" className="ts-input" value={entry} onChange={(e) => setEntry(e.target.value)} inputMode="decimal" /></label>
              {sizingMode === 'risk_percent' ? (
                <label className="ts-field"><span className="ts-label">Risk %</span>
                  <input name="risk_percent" className="ts-input" value={riskPercent} onChange={(e) => setRiskPercent(e.target.value)} inputMode="decimal" /></label>
              ) : (
                <label className="ts-field"><span className="ts-label">Lots</span>
                  <input name="lots" className="ts-input" value={lots} onChange={(e) => setLots(e.target.value)} inputMode="decimal" /></label>
              )}
            </div>

            <div className="ts-grid2 mt-3.5">
              <label className="ts-field"><span className="ts-label">Stop loss</span>
                <input name="stop_price" className="ts-input" value={stop} onChange={(e) => setStop(e.target.value)} inputMode="decimal" /></label>
              <label className="ts-field"><span className="ts-label">Take profit</span>
                <input name="target_price" className="ts-input" value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" /></label>
            </div>

            <label className="ts-field mt-3.5"><span className="ts-label">Exit price <span className="faint">(leave blank to keep open)</span></span>
              <input name="exit_price" className="ts-input" value={exit} onChange={(e) => setExit(e.target.value)} inputMode="decimal" /></label>

            {preview && (
              <div className="ts-compute mt-4">
                <div><div className="k">Risk : Reward</div><div className="v vio" style={{ color: 'var(--violet-deep)' }}>{preview.plannedRr ? `1 : ${preview.plannedRr.toFixed(2)}` : '—'}</div></div>
                <div><div className="k">SL pips</div><div className="v">{preview.slPips.toFixed(1)}</div></div>
                <div><div className="k">Est. P/L</div><div className="v ts-pos">{preview.estPnl != null ? `$${preview.estPnl.toFixed(2)}` : '—'}</div></div>
              </div>
            )}

            <div className="mt-4">
              <span className="ts-label">Setup type</span>
              <input name="setup_type" className="ts-input" list="setups" placeholder="e.g. Breakout" />
              <datalist id="setups">{SETUP_PRESETS.map((s) => <option key={s} value={s} />)}</datalist>
            </div>

            <div className="ts-grid2 mt-3.5">
              <label className="ts-field"><span className="ts-label">Confidence</span>
                <select name="confidence" className="ts-select"><option value="">—</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
              <label className="ts-field"><span className="ts-label">Emotion</span>
                <select name="emotion" className="ts-select"><option value="">—</option><option value="calm">Calm</option><option value="focused">Focused</option><option value="excited">Excited</option><option value="anxious">Anxious</option></select></label>
            </div>

            <div className="mt-4">
              <span className="ts-label">What went wrong / mistakes (optional)</span>
              <div className="ts-chips">
                {MISTAKE_TAGS.map((tag) => (
                  <label key={tag} className="ts-chip">
                    <input type="checkbox" name="mistake_tags" value={tag} checked={mistakes.includes(tag)} onChange={() => toggleMistake(tag)} /> {tag}
                  </label>
                ))}
              </div>
            </div>

            <label className="ts-field mt-4"><span className="ts-label">Why this trade? (note)</span>
              <textarea name="note" className="ts-textarea" rows={3} maxLength={280} placeholder="Setup, edge, market context…" /></label>

            <div className="ts-grid2 mt-3.5">
              <label className="ts-field"><span className="ts-label">Trade date</span>
                <input name="traded_at" type="datetime-local" className="ts-input" /></label>
              <label className="ts-field"><span className="ts-label">Visibility</span>
                <select name="is_public" className="ts-select" defaultValue={defaultPublic ? 'public' : 'private'}>
                  <option value="public">Public</option><option value="private">Private</option></select></label>
            </div>

            <label className="ts-field mt-3.5"><span className="ts-label">Attach chart (optional)</span>
              <input type="file" accept="image/png,image/jpeg" onChange={(e) => setChart(e.target.files?.[0] ?? null)} /></label>

            {error && <p className="ts-error mt-4">{error}</p>}
            <button className="btn btn-primary btn-block mt-5" disabled={pending}>{pending ? 'Saving…' : 'Save trade'}</button>
          </form>
        </div>
      )}
    </>
  )
}
