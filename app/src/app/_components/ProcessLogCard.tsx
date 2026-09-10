'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { logProcess, unlogProcess } from '@/app/actions/process'
import {
  PROCESS_KINDS, PROCESS_META, REFLECTION_OUTCOMES, REFLECTION_META,
  type ProcessKind, type ReflectionOutcome, type TodayEntry,
} from '@/lib/process'

/**
 * "Today's process" — where the reward system's only input is recorded.
 *
 * Available at every tier. The four buttons are the whole surface: there is no
 * volume quota left to satisfy, so a trader who reviewed their week and then
 * deliberately took nothing has done everything today's quest asks of them.
 *
 * Every action is awaited inside an async transition callback (CLAUDE.md): a
 * synchronous callback closes the transition before the write settles, leaving
 * the button live and the revalidated tree unapplied — which is how the feedback
 * status dropdown silently dropped its writes.
 */

export function ProcessLogCard({ today, compact = false }: { today: TodayEntry[]; compact?: boolean }) {
  const router = useRouter()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<ProcessKind | null>(null)
  const [pending, start] = useTransition()

  const done = new Map(today.map((e) => [e.kind, e.outcome]))

  const run = (kind: ProcessKind, fn: () => Promise<{ error?: string }>) => {
    setBusy(kind)
    start(async () => {
      const res = await fn()
      setBusy(null)
      if (res?.error) { setError(res.error); return }
      setError('')
      router.refresh()
    })
  }

  const toggle = (kind: ProcessKind) => {
    if (kind === 'rule_reflection') return // handled by the outcome row below
    if (done.has(kind)) run(kind, () => unlogProcess(kind))
    else run(kind, () => logProcess({ kind }))
  }

  const setOutcome = (outcome: ReflectionOutcome) => {
    const current = done.get('rule_reflection')
    if (current === outcome) run('rule_reflection', () => unlogProcess('rule_reflection'))
    else run('rule_reflection', () => logProcess({ kind: 'rule_reflection', outcome }))
  }

  const simpleKinds = PROCESS_KINDS.filter((k) => k !== 'rule_reflection')

  return (
    <div className="ts-card">
      <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <h2 className="ts-h2">Today’s process</h2>
        <span className="faint" style={{ fontSize: 12 }}>{done.size ? `${done.size} recorded` : 'Nothing recorded yet'}</span>
      </div>
      {!compact && (
        <p className="ts-sub mt-1">
          Quests, streaks and badges are earned here — not by placing trades. A day you
          deliberately stayed out counts the same as a day you traded.
        </p>
      )}

      <div className="mt-3" style={{ display: 'grid', gap: 8 }}>
        {simpleKinds.map((k) => {
          const isDone = done.has(k)
          return (
            <button
              key={k}
              type="button"
              onClick={() => toggle(k)}
              disabled={pending && busy === k}
              aria-pressed={isDone}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                padding: '10px 12px', borderRadius: 12, cursor: 'pointer',
                border: '1px solid ' + (isDone ? 'var(--up)' : 'var(--border)'),
                background: isDone ? 'var(--up-soft)' : 'transparent',
                opacity: pending && busy === k ? 0.6 : 1,
              }}
            >
              <span aria-hidden style={{ fontSize: 18 }}>{PROCESS_META[k].icon}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <b style={{ display: 'block' }}>{PROCESS_META[k].label}</b>
                <span className="faint" style={{ fontSize: 12 }}>{PROCESS_META[k].hint}</span>
              </span>
              <span aria-hidden style={{ color: isDone ? 'var(--up)' : 'var(--faint)' }}>{isDone ? '✓' : '+'}</span>
            </button>
          )
        })}

        <div style={{
          padding: '10px 12px', borderRadius: 12,
          border: '1px solid ' + (done.has('rule_reflection') ? 'var(--up)' : 'var(--border)'),
          background: done.has('rule_reflection') ? 'var(--up-soft)' : 'transparent',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span aria-hidden style={{ fontSize: 18 }}>{PROCESS_META.rule_reflection.icon}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <b style={{ display: 'block' }}>{PROCESS_META.rule_reflection.label}</b>
              <span className="faint" style={{ fontSize: 12 }}>{PROCESS_META.rule_reflection.hint}</span>
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {REFLECTION_OUTCOMES.map((o) => {
              const selected = done.get('rule_reflection') === o
              return (
                <button
                  key={o}
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setOutcome(o)}
                  disabled={pending && busy === 'rule_reflection'}
                  aria-pressed={selected}
                  title={REFLECTION_META[o].hint}
                  style={{
                    borderColor: selected ? 'var(--up)' : undefined,
                    fontWeight: selected ? 700 : undefined,
                  }}
                >
                  {selected ? '✓ ' : ''}{REFLECTION_META[o].label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {error && <p className="ts-error mt-2">{error}</p>}
    </div>
  )
}
