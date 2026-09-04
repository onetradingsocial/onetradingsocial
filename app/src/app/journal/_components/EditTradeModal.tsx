'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { updateTrade } from '@/app/actions/trade'
import { computeOpen, SETUP_PRESETS, type Direction, type SizingMode } from '@/lib/trade'
import { pipInfo } from '@/lib/instruments'
import { InstrumentCombobox } from '@/app/_components/InstrumentCombobox'
import { VERIFICATION_LABELS, tradeLevel } from '@/lib/verification'
import type { JTrade } from '@/lib/journal-stats'

const MARKETS = ['forex', 'crypto', 'stocks', 'indices', 'commodities'] as const
const CONFIDENCE = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']] as const
const EMOTIONS = [['calm', 'Calm', '😌'], ['focused', 'Focused', '🎯'], ['excited', 'Excited', '🤩'], ['anxious', 'Anxious', '😬']] as const

export type EditTradeConfig = {
  accountBalance: number
  canAdvancedJournal: boolean
  canPrivateNotes: boolean
  maxStrategyTags: number
}

/** numeric column -> input value. `0` is a real price, so only null/undefined blank out. */
const s = (v: number | null | undefined) => (v == null ? '' : String(v))

/** ISO timestamp -> the local-time shape `datetime-local` wants. */
function toLocalInput(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

export function EditTradeModal({ trade, config }: { trade: JTrade; config: EditTradeConfig }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>Edit</button>
      {open && <EditModal trade={trade} config={config} onClose={() => setOpen(false)} />}
    </>
  )
}

function EditModal({ trade, config, onClose }: { trade: JTrade; config: EditTradeConfig; onClose: () => void }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  // Execution fields on a statement- or broker-sourced trade are locked by the
  // 0028 `trades_protect_imported` trigger, and /verification tells users so.
  // The form does not offer them rather than letting the database reject the
  // save with a raw Postgres message.
  const manual = (trade.source ?? 'manual') === 'manual'

  const [market, setMarket] = useState(trade.market)
  const [instrument, setInstrument] = useState(trade.instrument)
  const [direction, setDirection] = useState<Direction>(trade.direction === 'short' ? 'short' : 'long')
  const [sizingMode, setSizingMode] = useState<SizingMode>(trade.sizing_mode === 'lots' ? 'lots' : 'risk_percent')
  const [entry, setEntry] = useState(s(trade.entry_price))
  const [stop, setStop] = useState(s(trade.stop_price))
  const [target, setTarget] = useState(s(trade.target_price))
  const [exit, setExit] = useState(s(trade.exit_price))
  const [riskPercent, setRiskPercent] = useState(s(trade.risk_percent))
  const [lots, setLots] = useState(s(trade.lots))
  const [setup, setSetup] = useState(trade.setup_type ?? '')
  const [confidence, setConfidence] = useState(trade.confidence ?? '')
  const [emotion, setEmotion] = useState(trade.emotion ?? '')
  // NOT sliced to the cap. The cap limits adding; slicing here would show a
  // lapsed Pro user one of their three tags and delete the other two on save.
  // `updateTrade` keeps stored tags for the same reason — see `keepThenCap`.
  const [stratTags, setStratTags] = useState<string[]>(trade.strategy_tags ?? [])
  const [stratDraft, setStratDraft] = useState('')

  const maxTradedAt = useMemo(
    () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16),
    [],
  )

  const preview = useMemo(() => {
    const e = Number(entry), st = Number(stop), t = target ? Number(target) : null
    if (!entry || !stop || !Number.isFinite(e) || !Number.isFinite(st)) return null
    const { pipSize, pipValuePerLot } = pipInfo(instrument, market)
    const r = computeOpen({
      direction, entry: e, stop: st, target: t, pipSize, sizingMode,
      riskPercent: Number(riskPercent) || 0, lots: Number(lots) || 0,
      accountBalance: config.accountBalance, pipValuePerLot,
    })
    return 'error' in r ? null : r
  }, [entry, stop, target, instrument, market, direction, sizingMode, riskPercent, lots, config.accountBalance])

  async function onSubmit(formData: FormData) {
    setPending(true); setError('')
    const res = await updateTrade(trade.id, formData)
    if (res.error) { setError(res.error); setPending(false); return }
    setPending(false); onClose(); router.refresh()
  }

  return (
    <div className="ts-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ts-modal ts-modal--wide">
        <div className="ts-modal-head">
          <div className="flex items-center gap-3">
            <span className="ts-modal-icon">✎</span>
            <div>
              <h2 className="ts-h2">Edit trade</h2>
              <p className="ts-sub">{trade.instrument} · {new Date(trade.traded_at).toLocaleDateString()}</p>
            </div>
          </div>
          <button type="button" className="ts-modal-close" onClick={onClose}>✕</button>
        </div>

        <form action={onSubmit}>
          {/* hidden values driven by buttons */}
          <input type="hidden" name="setup_type" value={setup} />
          <input type="hidden" name="confidence" value={confidence} />
          <input type="hidden" name="emotion" value={emotion} />
          {stratTags.map((t) => <input key={t} type="hidden" name="strategy_tags" value={t} />)}

          {manual ? (
            <>
              <input type="hidden" name="direction" value={direction} />
              <input type="hidden" name="sizing_mode" value={sizingMode} />

              <div className="ts-grid3">
                <label className="ts-field"><span className="ts-label">Market</span>
                  <select name="market" className="ts-select" value={market} onChange={(e) => setMarket(e.target.value)}>
                    {MARKETS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
                <label className="ts-field"><span className="ts-label">Instrument</span>
                  <InstrumentCombobox
                    value={instrument}
                    onChange={setInstrument}
                    onSelect={(r) => { setInstrument(r.symbol); setMarket(r.market) }}
                  />
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
                  <input name="entry_price" className="ts-input ts-input--lg" value={entry} onChange={(e) => setEntry(e.target.value)} inputMode="decimal" placeholder="0.00000" />
                </label>
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

              <div className="ts-grid2 mt-4">
                <label className="ts-field"><span className="ts-label">Trade date</span>
                  <input name="traded_at" type="datetime-local" max={maxTradedAt} className="ts-input" defaultValue={toLocalInput(trade.traded_at)} />
                </label>
                <label className="ts-field">
                  <span className="ts-label">Exit price{' '}
                    <span className="faint">{trade.status === 'closed' ? '(clearing it reopens the trade)' : '(fills to close now)'}</span>
                  </span>
                  <input name="exit_price" className="ts-input ts-input--lg" value={exit} onChange={(e) => setExit(e.target.value)} inputMode="decimal" placeholder="leave blank to keep open" />
                </label>
              </div>
            </>
          ) : (
            <>
              {/* Execution values ride along unchanged so the update writes back
                  exactly what is already stored — the trigger compares old to
                  new, and an omitted field would arrive as an empty string. */}
              <input type="hidden" name="market" value={trade.market} />
              <input type="hidden" name="instrument" value={trade.instrument} />
              <input type="hidden" name="direction" value={trade.direction} />
              <input type="hidden" name="sizing_mode" value={trade.sizing_mode ?? 'lots'} />
              <input type="hidden" name="entry_price" value={s(trade.entry_price)} />
              <input type="hidden" name="stop_price" value={s(trade.stop_price)} />
              <input type="hidden" name="target_price" value={s(trade.target_price)} />
              <input type="hidden" name="exit_price" value={s(trade.exit_price)} />
              <input type="hidden" name="risk_percent" value={s(trade.risk_percent)} />
              <input type="hidden" name="lots" value={s(trade.lots)} />
              <input type="hidden" name="traded_at" value={trade.traded_at} />

              <div className="ts-banner">
                <span>
                  🔒 This trade is <b>{VERIFICATION_LABELS[tradeLevel(trade.source)]}</b>. Its execution data —
                  instrument, direction, prices, size, result and timestamps — is locked at the database level and
                  cannot be edited after import. Journal fields (notes, emotional tags, strategy tags, visibility)
                  stay editable.{' '}
                  <Link href="/verification" style={{ color: 'var(--violet-br)', fontWeight: 700 }}>How verification works</Link>
                </span>
              </div>

              <div className="ts-compute mt-4">
                <div className="ts-compute-cell">
                  <div className="k">{trade.direction === 'long' ? '↗ Long' : '↘ Short'} {trade.instrument}</div>
                  <div className="v mono" style={{ fontSize: 16 }}>{s(trade.entry_price) || '—'} → {s(trade.exit_price) || 'open'}</div>
                </div>
                <div className="ts-compute-div" />
                <div className="ts-compute-cell">
                  <div className="k">Result</div>
                  <div className={`v ${(trade.pnl_amount ?? 0) >= 0 ? 'ts-pos' : 'ts-neg'}`}>
                    {trade.r_multiple != null
                      ? `${trade.r_multiple >= 0 ? '+' : ''}${trade.r_multiple.toFixed(1)}R`
                      : trade.pnl_amount != null
                        ? `${trade.pnl_amount >= 0 ? '+' : '−'}$${Math.abs(trade.pnl_amount).toFixed(0)}`
                        : '—'}
                  </div>
                </div>
              </div>
            </>
          )}

          {config.canAdvancedJournal ? (
            <>
              <div className="mt-5">
                <span className="ts-label">Setup type</span>
                <div className="ts-pills">
                  {SETUP_PRESETS.map((p) => (
                    <button key={p} type="button" className="ts-pill" data-active={setup === p} onClick={() => setSetup(setup === p ? '' : p)}>{p}</button>
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
                🔒 The <b>advanced journal</b> — setup type, confidence and emotion check-in — is a Trader perk.{' '}
                <Link href="/settings/billing" style={{ color: 'var(--violet-br)', fontWeight: 700 }}>Upgrade</Link>{' '}
                to log the full picture.
              </span>
            </div>
          )}

          {config.maxStrategyTags > 0 && (
            <div className="mt-4">
              <span className="ts-label">
                Strategy tags{' '}
                <span className="faint">
                  ({stratTags.length > config.maxStrategyTags
                    ? `your plan allows ${config.maxStrategyTags} — the ${stratTags.length} already on this trade are kept, but you cannot add more`
                    : config.maxStrategyTags === 1 ? 'one strategy — multi-strategy is a Pro perk' : `up to ${config.maxStrategyTags}`})
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

          <div className="mt-4">
            {config.canPrivateNotes ? (
              <label className="ts-field"><span className="ts-label">Why did you take this trade? <span className="faint">(private)</span></span>
                <textarea name="note" className="ts-textarea" rows={4} maxLength={280} defaultValue={trade.note ?? ''}
                  placeholder="Add a quick note about your setup, edge, or market context…" /></label>
            ) : (
              <div className="ts-field"><span className="ts-label">Why did you take this trade?</span>
                <p className="faint" style={{ fontSize: 12.5, marginTop: 6 }}>
                  🔒 Private journal notes are a Trader perk.{' '}
                  <Link href="/settings/billing" style={{ color: 'var(--violet-br)', fontWeight: 700 }}>Upgrade</Link>{' '}
                  to write them.
                </p>
              </div>
            )}
          </div>

          <label className="ts-field mt-4"><span className="ts-label">Visibility</span>
            <select name="is_public" className="ts-select" defaultValue={trade.is_public === false ? 'private' : 'public'}>
              <option value="public">Public</option><option value="private">Private</option></select></label>

          {error && <p className="ts-error mt-4">{error}</p>}

          <div className="ts-modal-foot mt-5">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={pending}>{pending ? 'Saving…' : '✓ Save changes'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
