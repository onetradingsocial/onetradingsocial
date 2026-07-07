'use client'

import Link from 'next/link'
import type { JTrade } from '@/lib/journal-stats'
import { tradesToCsv } from '@/lib/journal-export'

function downloadCsv(trades: JTrade[]) {
  const csv = tradesToCsv(trades)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `journal-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export function JournalExportButtons({ trades, canExport, canReport }: {
  trades: JTrade[]; canExport: boolean; canReport: boolean
}) {
  return (
    <div className="flex items-center gap-3">
      <button type="button" className="btn btn-ghost btn-sm" disabled={!canExport}
        title={canExport ? undefined : 'Export is a Trader+ perk'}
        onClick={() => downloadCsv(trades)}>
        Export CSV
      </button>
      {canReport
        ? <Link href="/journal/report" className="btn btn-ghost btn-sm" target="_blank">Download report</Link>
        : <button type="button" className="btn btn-ghost btn-sm" disabled title="Downloadable reports are a Pro perk">Download report</button>}
    </div>
  )
}
