import { rrBar } from '@/lib/post'

export type TradeCard = {
  instrument: string; direction: string
  entry_price: number; stop_price: number; target_price: number | null; exit_price: number | null
  r_multiple: number | null; pnl_amount: number | null; realized_pips: number | null
  status: string; screenshot_url: string | null; setup_type: string | null; strategy_tags: string[]
}

export function TradeAttachment({ t }: { t: TradeCard }) {
  const long = t.direction === 'long'
  const bar = rrBar(t.entry_price, t.stop_price, t.target_price, long ? 'long' : 'short')
  const result = t.status === 'open' ? 'Open'
    : t.r_multiple == null ? '—'
    : `${t.r_multiple >= 0 ? 'Win' : 'Loss'} · ${t.r_multiple >= 0 ? '+' : ''}${t.r_multiple.toFixed(1)}R`
  const tags = [t.setup_type, ...(t.strategy_tags ?? [])].filter(Boolean) as string[]
  const tick = (pos: number, kind: string, label: string) => (
    <div className={`ts-rrbar-tick ts-rrbar-tick--${kind}`} style={{ bottom: `${pos * 100}%` }}>
      <span className="ts-rrbar-tag">{label}</span><span className="ts-rrbar-line" />
    </div>
  )
  return (
    <div className="ts-trade-att">
      <div className="ts-trade-att-head">
        <span className="sym">{t.instrument}</span>
        <span className={`ts-side ${long ? 'ts-side--long' : 'ts-side--short'}`}>{long ? '↗ Long' : '↘ Short'}</span>
        <span className={`ts-badge ${t.status === 'open' ? 'ts-badge--open' : (t.r_multiple ?? 0) >= 0 ? 'ts-badge--win' : 'ts-badge--loss'}`} style={{ marginLeft: 'auto' }}>{result}</span>
      </div>
      <div className="ts-trade-att-grid">
        <div className="ts-rrbar">
          {tick(bar.stopPos, 'stop', 'SL')}
          {tick(bar.entryPos, 'entry', 'In')}
          {bar.targetPos != null && tick(bar.targetPos, 'target', 'TP')}
        </div>
        <div className="ts-trade-att-stats">
          <div className="ts-trade-att-stat"><dt>Entry</dt><dd>{t.entry_price}</dd></div>
          <div className="ts-trade-att-stat"><dt>Exit</dt><dd>{t.exit_price ?? '—'}</dd></div>
          <div className="ts-trade-att-stat"><dt>Net P/L</dt><dd className={t.pnl_amount == null ? '' : t.pnl_amount >= 0 ? 'ts-pos' : 'ts-neg'}>{t.pnl_amount == null ? '—' : `${t.pnl_amount >= 0 ? '+' : '−'}$${Math.abs(t.pnl_amount).toFixed(0)}`}</dd></div>
          <div className="ts-trade-att-stat"><dt>Pips</dt><dd>{t.realized_pips != null ? `${t.realized_pips >= 0 ? '+' : ''}${t.realized_pips.toFixed(1)}` : '—'}</dd></div>
        </div>
      </div>
      {tags.length > 0 && <div style={{ marginTop: 12 }}>{tags.slice(0, 3).map((x) => <span key={x} className="ts-tag">{x}</span>)}</div>}
      {t.screenshot_url && <img src={t.screenshot_url} alt="chart" className="ts-trade-att-shot" />}
    </div>
  )
}
