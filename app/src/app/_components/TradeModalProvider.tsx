'use client'

import { createContext, useContext, useState, useMemo, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { createTrade, saveTradeChartUrl } from '@/app/actions/trade'
import { computeOpen, SETUP_PRESETS, type Direction, type SizingMode } from '@/lib/trade'
import { INSTRUMENTS, pipInfo } from '@/lib/instruments'
import { Mt5ImportTab } from './Mt5ImportTab'

const MARKETS = ['forex', 'crypto', 'stocks', 'indices', 'commodities'] as const
const BUCKET = process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'OneTradingSocial'

type Config = { accountBalance: number; defaultPublic: boolean; canMt5Import: boolean; canAdvancedJournal: boolean; maxStrategyTags: number }

const TradeModalContext = createContext<{ open: () => void } | null>(null)

export function useTradeModal() {
  const ctx = useContext(TradeModalContext)
  if (!ctx) return { open: () => {} }
  return ctx
}

const CONFIDENCE = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']] as const
const EMOTIONS = [['calm', 'Calm', '😌'], ['focused', 'Focused', '🎯'], ['excited', 'Excited', '🤩'], ['anxious', 'Anxious', '😬']] as const

export function TradeModalProvider({ config, children }: { config: Config | null; children: React.ReactNode }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const openModal = useCallback(() => setOpen(true), [])

  return (
    <TradeModalContext.Provider value={{ open: openModal }}>
      {children}
      {open && config && (
        <TradeModal
          config={config}
          onClose={() => setOpen(false)}
          onSaved={() => { setOpen(false); router.refresh() }}
        />
      )}
    </TradeModalContext.Provider>
  )
}

function TradeModal({ config, onClose, onSaved }: { config: Config; onClose: () => void; onSaved: () => void }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'manual' | 'import'>('manual')

  const [market, setMarket] = useState('forex')
  const [instrument, setInstrument] = useState('EUR/USD')
  const [direction, setDirection] = useState<Direction>('long')
  const [sizingMode, setSizingMode] = useState<SizingMode>('risk_percent')
  const [entry, setEntry] = useState('')
  const [stop, setStop] = useState('')
  const [target, setTarget] = useState('')
  const [exit, setExit] = useState('')
  const [riskPercent, setRiskPercent] = useState('1')
  const [lots, setLots] = useState('1')
  const [setup, setSetup] = useState('')
  const [confidence, setConfidence] = useState('')
  const [emotion, setEmotion] = useState('')
  const [stratTags, setStratTags] = useState<string[]>([])
  const [stratDraft, setStratDraft] = useState('')
  const [chart, setChart] = useState<File | null>(null)
  const dropRef = useRef<HTMLInputElement>(null)

  const preview = useMemo(() => {
    const e = Number(entry), s = Number(stop), t = target ? Number(target) : null
    if (!entry || !stop || !Number.isFinite(e) || !Number.isFinite(s)) return null
    const { pipSize, pipValuePerLot } = pipInfo(instrument, market)
    const r = computeOpen({
      direction, entry: e, stop: s, target: t, pipSize, sizingMode,
      riskPercent: Number(riskPercent) || 0, lots: Number(lots) || 0,
      accountBalance: config.accountBalance, pipValuePerLot,
    })
    return 'error' in r ? null : r
  }, [entry, stop, target, instrument, market, direction, sizingMode, riskPercent, lots, config.accountBalance])

  async function onSubmit(formData: FormData) {
    setPending(true); setError('')
    const res = await createTrade({}, formData)
    if (res.error) { setError(res.error); setPending(false); return }
    if (chart && res.tradeId) {
      const ct = chart.type === 'image/png' ? 'image/png' : 'image/jpeg'
      const supabase = createClient()
      const signed = await fetch(`/api/trade-chart-url?tradeId=${res.tradeId}&ct=${encodeURIComponent(ct)}`).then((r) => r.json())
      if (signed?.path && signed?.token) {
        await supabase.storage.from(BUCKET).uploadToSignedUrl(signed.path, signed.token, chart, { upsert: true })
        await saveTradeChartUrl(res.tradeId, signed.publicUrl)
      }
    }
    setPending(false); onSaved()
  }

  return (
    <div className="ts-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ts-modal ts-modal--wide">
        <div className="ts-modal-head">
          <div className="flex items-center gap-3">
            <span className="ts-modal-icon">⚡</span>
            <div>
              <h2 className="ts-h2">Quick Trade Capture</h2>
              <p className="ts-sub">Log your trade in seconds. Stay consistent.</p>
            </div>
          </div>
          <button type="button" className="ts-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="ts-subtabs mt-4" style={{ maxWidth: 320 }}>
          <button type="button" data-active={tab === 'manual'} onClick={() => setTab('manual')}>Manual entry</button>
          <button type="button" data-active={tab === 'import'} onClick={() => setTab('import')}>
            Import from MT5{!config.canMt5Import && ' 🔒'}
          </button>
        </div>

        {tab === 'import' ? (
          <div className="mt-4">
            <Mt5ImportTab canImport={config.canMt5Import} onDone={onSaved} />
          </div>
        ) : (
        <form action={onSubmit}>
        {/* hidden values driven by buttons */}
        <input type="hidden" name="direction" value={direction} />
        <input type="hidden" name="sizing_mode" value={sizingMode} />
        <input type="hidden" name="setup_type" value={setup} />
        <input type="hidden" name="confidence" value={confidence} />
        <input type="hidden" name="emotion" value={emotion} />
        {stratTags.map((t) => <input key={t} type="hidden" name="strategy_tags" value={t} />)}

        <div className="ts-grid3">
          <label className="ts-field"><span className="ts-label">Market</span>
            <select name="market" className="ts-select" value={market} onChange={(e) => setMarket(e.target.value)}>
              {MARKETS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="ts-field"><span className="ts-label">Instrument</span>
            <input name="instrument" className="ts-input" value={instrument} list="instlist" onChange={(e) => setInstrument(e.target.value)} />
            <datalist id="instlist">{INSTRUMENTS.map((i) => <option key={i.symbol} value={i.symbol}>{i.name}</option>)}</datalist>
          </label>
          <div className="ts-field"><span className="ts-label">Direction</span>
            <div className="ts-toggle">
              <button type="button" data-active={direction === 'long'} data-kind="buy" onClick={() => setDirection('long')}>↗ Buy</button>
              <button type="button" data-active={direction === 'short'} data-kind="sell" onClick={() => setDirection('short')}>↘ Sell</button>
            </div>
          </div>
        </div>

        <div className="ts-grid2 mt-4">
          <div className="ts-field"><span className="ts-label">Risk % / Lot Size</span>
            <div className="ts-subtabs">
              <button type="button" data-active={sizingMode === 'risk_percent'} onClick={() => setSizingMode('risk_percent')}>Risk %</button>
              <button type="button" data-active={sizingMode === 'lots'} onClick={() => setSizingMode('lots')}>Lot Size</button>
            </div>
            {sizingMode === 'risk_percent' ? (
              <div className="ts-suffix"><input name="risk_percent" className="ts-input" value={riskPercent} onChange={(e) => setRiskPercent(e.target.value)} inputMode="decimal" /><span>%</span></div>
            ) : (
              <input name="lots" className="ts-input mt-2" value={lots} onChange={(e) => setLots(e.target.value)} inputMode="decimal" placeholder="Lots" />
            )}
          </div>
          <label className="ts-field"><span className="ts-label">Entry price</span>
            <input name="entry_price" className="ts-input ts-input--lg" value={entry} onChange={(e) => setEntry(e.target.value)} inputMode="decimal" placeholder="0.00000" /></label>
        </div>

        <div className="ts-grid2 mt-4">
          <div className="ts-field"><span className="ts-label">Stop loss</span>
            <div className="ts-inwrap">
              <input name="stop_price" className="ts-input" value={stop} onChange={(e) => setStop(e.target.value)} inputMode="decimal" placeholder="0.00000" />
              {preview && <span className="ts-pip ts-pip-neg">−{preview.slPips.toFixed(1)} pips</span>}
            </div>
          </div>
          <div className="ts-field"><span className="ts-label">Take profit</span>
            <div className="ts-inwrap">
              <input name="target_price" className="ts-input" value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" placeholder="0.00000" />
              {preview?.tpPips != null && <span className="ts-pip ts-pip-pos">+{preview.tpPips.toFixed(1)} pips</span>}
            </div>
          </div>
        </div>

        <div className="ts-compute mt-4">
          <div className="ts-compute-cell">
            <div className="k">Risk : Reward</div>
            <div className="v" style={{ color: 'var(--violet-deep)' }}>{preview?.plannedRr ? `1 : ${preview.plannedRr.toFixed(2)}` : '—'}</div>
          </div>
          <div className="ts-compute-div" />
          <div className="ts-compute-cell">
            <div className="k">Est. P/L {sizingMode === 'risk_percent' && riskPercent ? `(${riskPercent}%)` : ''}</div>
            <div className="v ts-pos">{preview?.estPnl != null ? `+$${preview.estPnl.toFixed(2)}` : '—'}</div>
          </div>
        </div>

        <div className="ts-ai mt-4">
          <span className="ts-ai-icon">✦</span>
          <div className="ts-ai-body">
            <span className="ts-ai-label">AI Insight</span>
            <p>Pattern matching and setup grading arrive in a later release.</p>
          </div>
          <span className="ts-soon">soon</span>
        </div>

        {config.canAdvancedJournal ? (
          <>
            <div className="mt-5">
              <span className="ts-label">Setup type</span>
              <div className="ts-pills">
                {SETUP_PRESETS.map((s) => (
                  <button key={s} type="button" className="ts-pill" data-active={setup === s} onClick={() => setSetup(setup === s ? '' : s)}>{s}</button>
                ))}
                <input className="ts-pill-input" placeholder="+ Custom" value={SETUP_PRESETS.includes(setup as typeof SETUP_PRESETS[number]) ? '' : setup} onChange={(e) => setSetup(e.target.value)} />
              </div>
            </div>

            <div className="ts-grid2 mt-4">
              <div className="ts-field"><span className="ts-label">Confidence</span>
                <div className="ts-pills">
                  {CONFIDENCE.map(([v, l]) => (
                    <button key={v} type="button" className="ts-pill" data-active={confidence === v} onClick={() => setConfidence(confidence === v ? '' : v)}>{l}</button>
                  ))}
                </div>
              </div>
              <div className="ts-field"><span className="ts-label">Emotion check-in</span>
                <div className="ts-pills">
                  {EMOTIONS.map(([v, l, e]) => (
                    <button key={v} type="button" className="ts-pill" data-active={emotion === v} data-kind="emotion" onClick={() => setEmotion(emotion === v ? '' : v)}>{e} {l}</button>
                  ))}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="ts-banner mt-5">
            <span>
              🔒 The <b>advanced journal</b> — setup type, confidence, emotion check-in and chart uploads — is a Trader perk.{' '}
              <a href="/settings/billing" style={{ color: 'var(--violet-br)', fontWeight: 700 }}>Upgrade</a>{' '}
              to log the full picture.
            </span>
          </div>
        )}

        {config.maxStrategyTags > 0 && (
          <div className="mt-4">
            <span className="ts-label">
              Strategy tags{' '}
              <span className="faint">
                ({config.maxStrategyTags === 1 ? 'one strategy — multi-strategy is a Pro perk' : `up to ${config.maxStrategyTags}`})
              </span>
            </span>
            <div className="ts-pills">
              {stratTags.map((t) => (
                <button key={t} type="button" className="ts-pill" data-active
                  onClick={() => setStratTags(stratTags.filter((x) => x !== t))}>
                  {t} ✕
                </button>
              ))}
              {stratTags.length < config.maxStrategyTags && (
                <input
                  className="ts-pill-input"
                  placeholder="+ Add strategy"
                  value={stratDraft}
                  maxLength={30}
                  onChange={(e) => setStratDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    e.preventDefault()
                    const v = stratDraft.trim()
                    if (v && !stratTags.includes(v)) setStratTags([...stratTags, v])
                    setStratDraft('')
                  }}
                />
              )}
            </div>
          </div>
        )}

        <div className="ts-grid2 mt-4" style={{ alignItems: 'start' }}>
          <label className="ts-field"><span className="ts-label">Why are you taking this trade?</span>
            <textarea name="note" className="ts-textarea" rows={4} maxLength={280} placeholder="Add a quick note about your setup, edge, or market context…" /></label>
          {config.canAdvancedJournal && (
            <div className="ts-field"><span className="ts-label">Attach chart <span className="faint">(optional)</span></span>
              <button type="button" className="ts-dropzone" onClick={() => dropRef.current?.click()}>
                <span className="ts-dropzone-icon">⬆</span>
                <span className="ts-dropzone-main">{chart ? chart.name : 'Click to upload'}</span>
                <span className="faint" style={{ fontSize: 12 }}>PNG, JPG up to 5MB</span>
              </button>
              <input ref={dropRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => setChart(e.target.files?.[0] ?? null)} />
            </div>
          )}
        </div>

        <div className="ts-grid2 mt-4">
          <label className="ts-field"><span className="ts-label">Trade date <span className="faint">(optional)</span></span>
            <input name="traded_at" type="datetime-local" className="ts-input" /></label>
          <label className="ts-field"><span className="ts-label">Exit price <span className="faint">(fills to close now)</span></span>
            <input name="exit_price" className="ts-input" value={exit} onChange={(e) => setExit(e.target.value)} inputMode="decimal" placeholder="leave blank to keep open" /></label>
        </div>

        <label className="ts-field mt-4"><span className="ts-label">Visibility</span>
          <select name="is_public" className="ts-select" defaultValue={config.defaultPublic ? 'public' : 'private'}>
            <option value="public">Public</option><option value="private">Private</option></select></label>

        {error && <p className="ts-error mt-4">{error}</p>}

        <div className="ts-modal-foot mt-5">
          <label className="ts-checkline" style={{ alignItems: 'center' }}>
            <input type="checkbox" disabled /> <span className="faint">Save as template <span className="ts-soon">soon</span></span>
          </label>
          <button className="btn btn-primary" disabled={pending}>{pending ? 'Saving…' : '✓ Save Trade'}</button>
        </div>
        </form>
        )}
      </div>
    </div>
  )
}
