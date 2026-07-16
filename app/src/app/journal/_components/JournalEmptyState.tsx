'use client'

import Link from 'next/link'
import { useTradeModal } from '@/app/_components/TradeModalProvider'

/**
 * Rich journal empty state (Sprint 2, row 13): why journaling matters, the
 * three ways to get data in, honest setup times, one primary action and a
 * sample of the insight that unlocks.
 */
export function JournalEmptyState({ canImport }: { canImport: boolean }) {
  const { open } = useTradeModal()
  return (
    <div className="ts-card mt-5" style={{ padding: '28px 26px' }}>
      <div style={{ maxWidth: 640 }}>
        <h2 className="ts-h2" style={{ fontSize: 22 }}>Your journal is empty — fix that in under a minute.</h2>
        <p className="ts-sub mt-2" style={{ lineHeight: 1.6 }}>
          Traders who journal consistently spot their most expensive mistake within weeks.
          Every stat on your profile — win rate, equity curve, weekly review — is computed from what you log here.
        </p>
      </div>

      <div className="ts-grid3 mt-5">
        <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ fontWeight: 700 }}>⚡ Quick log</div>
          <p className="faint" style={{ fontSize: 13, margin: '6px 0' }}>Market, direction, prices, size. Done.</p>
          <span className="v-badge">~60 seconds</span>
        </div>
        <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ fontWeight: 700 }}>📄 MT5 statement</div>
          <p className="faint" style={{ fontSize: 13, margin: '6px 0' }}>Upload your report file — full history in one go.{!canImport && ' (Trader plan)'}</p>
          <span className="v-badge">~3 minutes</span>
        </div>
        <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ fontWeight: 700 }}>🔗 Broker sync</div>
          <p className="faint" style={{ fontSize: 13, margin: '6px 0' }}>Connect MT5 once, trades arrive verified.{!canImport && ' (Trader plan)'}</p>
          <span className="v-badge">~5 minutes, once</span>
        </div>
      </div>

      <div className="mt-5" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary" onClick={open}>+ Log your first trade</button>
        <Link href="/settings#broker" className="btn">Connect MT5</Link>
        <Link href="/verification" className="faint" style={{ fontSize: 13 }}>How verification works →</Link>
      </div>

      <div className="mt-5" style={{ display: 'flex', gap: 10, padding: '12px 16px', borderRadius: 12, background: 'var(--brand-grad-soft)', border: '1px solid var(--border-vio)', maxWidth: 640 }}>
        <span aria-hidden>✦</span>
        <span style={{ fontSize: 13.5, lineHeight: 1.55 }}>
          <b style={{ display: 'block' }}>The kind of insight you&apos;ll unlock</b>
          &ldquo;Your London-session trades outperform New York by 18% — and most of your losses come after two consecutive wins.&rdquo;
        </span>
      </div>
    </div>
  )
}
