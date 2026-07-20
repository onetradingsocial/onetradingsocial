'use client'

import { useState, useActionState } from 'react'
import { saveTradingRules, type RulesState } from '@/app/actions/rules'
import { SESSION_LABELS, VIOLATION_LABELS, type TradingRules, type ComplianceResult, type Violation } from '@/lib/rules'

function money(n: number) {
  const a = `$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  return n < 0 ? `−${a}` : a
}

export function RulesCard({ rules, compliance, locked }: {
  rules: TradingRules; compliance: ComplianceResult | null; locked: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [state, action, pending] = useActionState<RulesState, FormData>(saveTradingRules, {})

  // Locked cards render nothing — LockedFeatures lists them once at the page foot.
  if (locked) return null

  const total = compliance ? compliance.followed + compliance.broken : 0
  const followPct = total ? Math.round((compliance!.followed / total) * 100) : 0
  const topBroken = compliance
    ? (Object.entries(compliance.brokenByRule) as [Violation, number][]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])
    : []

  return (
    <div className="ts-card">
      <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <h2 className="ts-h2">Trading rules</h2>
        <button type="button" className="btn btn-sm" onClick={() => setEditing((v) => !v)}>
          {editing ? 'Close' : 'Edit rules'}
        </button>
      </div>

      {editing && (
        <form action={action} className="ts-grid2 mt-4" style={{ alignItems: 'end' }}>
          <label className="ts-field"><span className="ts-label">Max trades / day</span>
            <input name="max_trades_per_day" className="ts-input" inputMode="numeric" defaultValue={rules.maxTradesPerDay ?? ''} placeholder="e.g. 2" /></label>
          <label className="ts-field"><span className="ts-label">Minimum R:R</span>
            <input name="min_rr" className="ts-input" inputMode="decimal" defaultValue={rules.minRr ?? ''} placeholder="e.g. 2" /></label>
          <label className="ts-field"><span className="ts-label">Max risk %</span>
            <input name="max_risk_percent" className="ts-input" inputMode="decimal" defaultValue={rules.maxRiskPercent ?? ''} placeholder="e.g. 1" /></label>
          <label className="ts-field"><span className="ts-label">No trade after N losses</span>
            <input name="no_trade_after_losses" className="ts-input" inputMode="numeric" defaultValue={rules.noTradeAfterLosses ?? ''} placeholder="e.g. 2" /></label>
          <label className="ts-field"><span className="ts-label">Only trade session</span>
            <select name="session" className="ts-select" defaultValue={rules.session ?? ''}>
              <option value="">Any session</option>
              {(Object.keys(SESSION_LABELS) as (keyof typeof SESSION_LABELS)[]).map((s) => (
                <option key={s} value={s}>{SESSION_LABELS[s]}</option>
              ))}
            </select>
          </label>
          <label className="ts-chip" style={{ alignSelf: 'center' }}>
            <input type="checkbox" name="require_stop" defaultChecked={rules.requireStop} /> Stop-loss required
          </label>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10, alignItems: 'center' }}>
            <button className="btn btn-primary" disabled={pending}>{pending ? 'Saving…' : 'Save rules'}</button>
            {state.ok && <span className="settings-saved">Saved.</span>}
            {state.error && <span className="ts-error">{state.error}</span>}
          </div>
        </form>
      )}

      {!compliance || total === 0 ? (
        <p className="faint mt-4" style={{ fontSize: 13 }}>
          {topBroken.length === 0 && !editing ? 'Set your rules above, then close trades to see compliance.' : 'Close some trades to see rule compliance.'}
        </p>
      ) : (
        <>
          <div className="ts-compute mt-4">
            <div className="ts-compute-cell">
              <div className="k">Rules followed</div>
              <div className="v" style={{ color: 'var(--up)' }}>{compliance.followed} · {followPct}%</div>
            </div>
            <div className="ts-compute-div" />
            <div className="ts-compute-cell">
              <div className="k">Rules broken</div>
              <div className="v ts-neg">{compliance.broken}</div>
            </div>
            <div className="ts-compute-div" />
            <div className="ts-compute-cell">
              <div className="k">Cost of broken rules</div>
              <div className="v ts-neg">{money(compliance.costOfBroken)}</div>
            </div>
          </div>

          <div className="ts-grid2 mt-4">
            <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px' }}>
              <div className="faint" style={{ fontSize: 12 }}>When compliant ({compliance.compliantCount})</div>
              <div style={{ fontWeight: 700, marginTop: 4 }}>
                {money(compliance.compliantPnl)} · {Math.round(compliance.compliantWinRate * 100)}% win
              </div>
            </div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px' }}>
              <div className="faint" style={{ fontSize: 12 }}>When breaking rules ({compliance.nonCompliantCount})</div>
              <div style={{ fontWeight: 700, marginTop: 4 }}>
                {money(compliance.nonCompliantPnl)} · {Math.round(compliance.nonCompliantWinRate * 100)}% win
              </div>
            </div>
          </div>

          {topBroken.length > 0 && (
            <div className="mt-4" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {topBroken.map(([rule, n]) => (
                <span key={rule} className="v-badge vb-failed">{VIOLATION_LABELS[rule]}: {n}</span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
