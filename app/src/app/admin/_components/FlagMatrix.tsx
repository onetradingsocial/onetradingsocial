'use client'

import { useState, useTransition } from 'react'
import { setFeatureFlag, resetFeatureFlag } from '@/app/actions/admin'
import type { FlagValues } from '@/lib/feature-flags'

export type FlagRowView = {
  key: string
  label: string
  defaultTier: string
  values: FlagValues
  defaults: FlagValues
  wired: boolean
  note?: string | null
}

export type FlagGroup = { title: string; rows: FlagRowView[] }

const TIERS = ['free', 'trader', 'pro'] as const
const TIER_TINT: Record<string, string> = { free: 'var(--faint)', trader: 'var(--violet-br)', pro: '#E0931E' }

function Row({ row }: { row: FlagRowView }) {
  const [values, setValues] = useState(row.values)
  const [pending, start] = useTransition()
  const isDefault =
    values.free === row.defaults.free &&
    values.trader === row.defaults.trader &&
    values.pro === row.defaults.pro

  const toggle = (tier: (typeof TIERS)[number], checked: boolean) => {
    const next = { ...values, [tier]: checked }
    start(async () => {
      const r = await setFeatureFlag(row.key, next)
      if (!r.error) setValues(next)
    })
  }

  const reset = () => start(async () => {
    const r = await resetFeatureFlag(row.key)
    if (!r.error) setValues(row.defaults)
  })

  return (
    <tr style={pending ? { opacity: 0.55 } : undefined}>
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ textTransform: 'capitalize', fontWeight: 600 }}>{row.label}</span>
          <span className="ts-chip2" style={{ fontSize: 10.5, padding: '2px 8px', color: TIER_TINT[row.defaultTier] }}>
            {row.defaultTier}+
          </span>
          {!row.wired && (
            <span className="ts-chip2" style={{ fontSize: 10.5, padding: '2px 8px' }} title={row.note ?? 'No live canFlag() gate yet — toggle takes effect when the feature ships'}>
              {row.note ?? 'not wired yet'}
            </span>
          )}
          {!isDefault && (
            <span title="Differs from code default"
              style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--violet-br)', display: 'inline-block' }} />
          )}
        </div>
      </td>
      {TIERS.map((t) => (
        <td key={t} style={{ textAlign: 'center' }}>
          <input type="checkbox" checked={values[t]} disabled={pending}
            aria-label={`${row.label} — ${t}`}
            style={{ width: 17, height: 17, accentColor: 'var(--violet-br)', cursor: pending ? 'wait' : 'pointer' }}
            onChange={(e) => toggle(t, e.target.checked)} />
        </td>
      ))}
      <td style={{ textAlign: 'right' }}>
        {!isDefault && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={reset}>
            Reset
          </button>
        )}
      </td>
    </tr>
  )
}

export function FlagMatrix({ groups }: { groups: FlagGroup[] }) {
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {groups.map((g) => (
        <div key={g.title} className="ad-panel">
          <div className="ad-panel-head"><span className="t">{g.title}</span></div>
          <table className="ts-table" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col />
              <col style={{ width: 76 }} />
              <col style={{ width: 76 }} />
              <col style={{ width: 76 }} />
              <col style={{ width: 90 }} />
            </colgroup>
            <thead>
              <tr>
                <th>Feature</th>
                <th style={{ textAlign: 'center' }}>Free</th>
                <th style={{ textAlign: 'center' }}>Trader</th>
                <th style={{ textAlign: 'center' }}>Pro</th>
                <th></th>
              </tr>
            </thead>
            <tbody>{g.rows.map((r) => <Row key={r.key} row={r} />)}</tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
