'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addGoal, removeGoal } from '@/app/actions/goals'
import { GOAL_META, type Goal, type GoalKind, type GoalProgress } from '@/lib/goals'

export type GoalWithProgress = Goal & { progress: GoalProgress }

export function GoalsCard({ goals }: { goals: GoalWithProgress[] }) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState<GoalKind>('journal_consistency')
  const [target, setTarget] = useState('80')
  const [windowDays, setWindowDays] = useState('30')
  const [error, setError] = useState('')
  const [pending, start] = useTransition()

  const kinds = Object.keys(GOAL_META) as GoalKind[]

  return (
    <div className="ts-card">
      <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <h2 className="ts-h2">Process goals</h2>
        <button type="button" className="btn btn-sm" onClick={() => setAdding((v) => !v)}>{adding ? 'Close' : '+ Add goal'}</button>
      </div>
      <p className="ts-sub mt-1">Goals that reward good process — not profit.</p>

      {adding && (
        <div className="ts-grid3 mt-3" style={{ alignItems: 'end' }}>
          <label className="ts-field"><span className="ts-label">Goal</span>
            <select className="ts-select" value={kind} onChange={(e) => setKind(e.target.value as GoalKind)}>
              {kinds.map((k) => <option key={k} value={k}>{GOAL_META[k].label}</option>)}
            </select>
          </label>
          <label className="ts-field"><span className="ts-label">Target{GOAL_META[kind].unit}</span>
            <input className="ts-input" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
          </label>
          <label className="ts-field"><span className="ts-label">Window (days)</span>
            <input className="ts-input" inputMode="numeric" value={windowDays} onChange={(e) => setWindowDays(e.target.value)} />
          </label>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10, alignItems: 'center' }}>
            <button className="btn btn-primary" disabled={pending}
              onClick={() => start(async () => {
                const r = await addGoal({ kind, target: Number(target), windowDays: Number(windowDays) })
                if (r.error) { setError(r.error); return }
                setError(''); setAdding(false); router.refresh()
              })}>Add</button>
            <span className="faint" style={{ fontSize: 12 }}>{GOAL_META[kind].hint}</span>
            {error && <span className="ts-error">{error}</span>}
          </div>
        </div>
      )}

      {goals.length === 0 ? (
        <p className="faint mt-3" style={{ fontSize: 13 }}>No goals yet. Add one — e.g. journal 80% of trading days.</p>
      ) : (
        <div className="mt-4" style={{ display: 'grid', gap: 12 }}>
          {goals.map((g) => (
            <div key={g.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, marginBottom: 4 }}>
                <span>{GOAL_META[g.kind].label}{g.progress.met && <span style={{ color: 'var(--up)', marginLeft: 6 }}>✓ met</span>}</span>
                <span className="faint">
                  {g.progress.current}{GOAL_META[g.kind].unit} / {g.target}{GOAL_META[g.kind].unit} · {g.windowDays}d
                  <button type="button" onClick={() => start(async () => { await removeGoal(g.id); router.refresh() })}
                    style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--faint)', marginLeft: 8 }}>✕</button>
                </span>
              </div>
              <div style={{ height: 7, borderRadius: 999, background: 'var(--surface-3)', overflow: 'hidden' }}>
                <i style={{ display: 'block', height: '100%', width: `${g.progress.pct}%`, background: g.progress.met ? 'var(--up)' : 'var(--brand-grad)' }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
