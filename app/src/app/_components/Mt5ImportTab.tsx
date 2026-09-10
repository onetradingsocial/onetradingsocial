'use client'

import { useRef, useState } from 'react'
import { parseMt5Statement, commitMt5Import, type ParsedRow } from '@/app/actions/mt5-import'
import Link from 'next/link'

const fmtTime = (iso: string) => iso.replace('T', ' ').replace('Z', '').slice(0, 16)
const fmtPnl = (n: number) => `${n >= 0 ? '+' : '−'}$${Math.abs(n).toFixed(2)}`

export function Mt5ImportTab({ canImport, onDone }: { canImport: boolean; onDone: () => void }) {
  const [rows, setRows] = useState<ParsedRow[] | null>(null)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [skipped, setSkipped] = useState(0)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [inserted, setInserted] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  if (!canImport) {
    return (
      <div className="ts-mt5-locked">
        <span style={{ fontSize: 28 }}>🔒</span>
        <p className="ts-sub" style={{ margin: '8px 0 12px' }}>
          Import your MT5 trade history automatically with the Trader plan.
        </p>
        <Link href="/settings/billing" className="btn btn-primary">Upgrade to Trader</Link>
      </div>
    )
  }

  async function onFile(file: File | null) {
    if (!file) return
    setPending(true); setError('')
    const fd = new FormData()
    fd.set('file', file)
    const res = await parseMt5Statement(fd)
    setPending(false)
    if (res.error) { setError(res.error); return }
    setRows(res.rows ?? [])
    setSkipped(res.skipped ?? 0)
    setExcluded(new Set())
  }

  async function onConfirm() {
    if (!rows) return
    const selected = rows.filter((r) => !r.duplicate && !excluded.has(r.ticket))
      .map(({ duplicate: _d, ...deal }) => deal)
    if (selected.length === 0) { setError('Nothing selected.'); return }
    setPending(true); setError('')
    const res = await commitMt5Import(selected)
    setPending(false)
    if (res.error) { setError(res.error); return }
    setInserted(res.inserted ?? selected.length)
  }

  if (inserted != null) {
    return (
      <div className="ts-mt5-locked">
        <span style={{ fontSize: 28 }}>✓</span>
        <p className="ts-sub" style={{ margin: '8px 0 4px' }}>
          Imported {inserted} trade{inserted === 1 ? '' : 's'} to your journal.
        </p>
        {/*
          The reflection step (audit 2026-09-05, Wave D4) is per TRADE, and one
          upload can land two hundred of them — a two-hundred-step wizard here
          would be a two-hundred-step dismissal, so the prompt is not inlined.
          The handoff goes to the journal's reflect card instead, which is
          anchored at #reflect and lists exactly the trades still waiting.

          Imported execution data stays locked; the reflection does not. That is
          the whole reason this link exists: import is how most real evidence
          arrives, so a cycle a user could only complete on hand-typed trades
          would not be a cycle.
        */}
        <p className="faint" style={{ margin: '0 0 12px', fontSize: 12 }}>
          Next: say whether they followed your rules. Their execution data stays as
          your broker reported it — the reflection is yours.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/journal#reflect" className="btn btn-primary" onClick={onDone}>
            Reflect on {inserted === 1 ? 'it' : 'them'}
          </Link>
          <button type="button" className="btn" onClick={onDone}>Done</button>
        </div>
      </div>
    )
  }

  if (!rows) {
    return (
      <div>
        <button type="button" className="ts-dropzone" onClick={() => fileRef.current?.click()} disabled={pending}>
          <span className="ts-dropzone-icon">⬆</span>
          <span className="ts-dropzone-main">{pending ? 'Parsing…' : 'Upload MT5 history report'}</span>
          <span className="faint" style={{ fontSize: 12 }}>HTML, XLSX or CSV up to 1MB</span>
        </button>
        <input
          ref={fileRef} type="file" accept=".html,.htm,.xlsx,.csv" className="hidden"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
        <p className="faint mt-3" style={{ fontSize: 12 }}>
          In MT5: right-click your Account History → Report → HTML (or Open XML), then upload the file here.
          Trade times use your broker&#39;s server time.
        </p>
        {error && <p className="ts-error mt-4">{error}</p>}
      </div>
    )
  }

  const dupes = rows.filter((r) => r.duplicate).length
  const selectedCount = rows.length - dupes - excluded.size

  return (
    <div>
      <div className="ts-mt5-tablewrap">
        <table className="ts-mt5-table">
          <thead>
            <tr><th></th><th>Symbol</th><th>Side</th><th>Lots</th><th>Opened</th><th>Closed</th><th>Net P&L</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ticket} data-dupe={r.duplicate || undefined}>
                <td>
                  <input
                    type="checkbox" disabled={r.duplicate}
                    checked={!r.duplicate && !excluded.has(r.ticket)}
                    onChange={(e) => {
                      const next = new Set(excluded)
                      if (e.target.checked) next.delete(r.ticket); else next.add(r.ticket)
                      setExcluded(next)
                    }}
                  />
                </td>
                <td>{r.symbol}</td>
                <td>{r.direction === 'long' ? '↗ Buy' : '↘ Sell'}</td>
                <td>{r.lots}</td>
                <td>{fmtTime(r.openTime)}</td>
                <td>{r.duplicate ? <span className="faint">already imported</span> : fmtTime(r.closeTime)}</td>
                <td className={r.netPnl >= 0 ? 'ts-pos' : 'ts-neg'}>{fmtPnl(r.netPnl)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="faint mt-2" style={{ fontSize: 12 }}>
        {selectedCount} selected · {dupes} duplicate{dupes === 1 ? '' : 's'} skipped
        {skipped > 0 ? ` · ${skipped} unreadable row${skipped === 1 ? '' : 's'} ignored` : ''}
      </p>
      {error && <p className="ts-error mt-4">{error}</p>}
      <div className="ts-modal-foot mt-5">
        <button type="button" className="btn" onClick={() => { setRows(null); setError('') }} disabled={pending}>← Back</button>
        <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={pending || selectedCount === 0}>
          {pending ? 'Importing…' : `✓ Import ${selectedCount} trade${selectedCount === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  )
}
