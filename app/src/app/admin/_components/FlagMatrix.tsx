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
}

const TIERS = ['free', 'trader', 'pro'] as const

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
    <tr>
      <td style={{ textTransform: 'capitalize' }}>
        {row.label} <span className="faint">(default: {row.defaultTier}+)</span>
        {!row.wired && <span className="faint"> · not wired yet</span>}
      </td>
      {TIERS.map((t) => (
        <td key={t} style={{ textAlign: 'center' }}>
          <input type="checkbox" checked={values[t]} disabled={pending}
            aria-label={`${row.label} — ${t}`}
            onChange={(e) => toggle(t, e.target.checked)} />
        </td>
      ))}
      <td>
        {!isDefault && (
          <button type="button" className="btn btn-sm" disabled={pending} onClick={reset}>
            Reset
          </button>
        )}
      </td>
    </tr>
  )
}

export function FlagMatrix({ rows }: { rows: FlagRowView[] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ textAlign: 'left' }}>
          <th>Feature</th>
          <th style={{ textAlign: 'center' }}>Free</th>
          <th style={{ textAlign: 'center' }}>Trader</th>
          <th style={{ textAlign: 'center' }}>Pro</th>
          <th></th>
        </tr>
      </thead>
      <tbody>{rows.map((r) => <Row key={r.key} row={r} />)}</tbody>
    </table>
  )
}
