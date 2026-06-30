'use client'

import { useTradeModal } from '@/app/_components/TradeModalProvider'
import { Icon } from './Icon'

// Owner-only CTA. Opens the global Quick Trade modal.
export function LogTradeBand() {
  const { open } = useTradeModal()
  return (
    <button className="h-logband h-reveal" onClick={open} type="button">
      <div className="h-ink-grid" />
      <span className="lb-ic"><Icon name="bolt" size={28} /></span>
      <div className="lb-tx">
        <h2>Log a trade</h2>
        <p>Capture today&apos;s setups while they&apos;re fresh — every entry sharpens your edge and feeds your streak.</p>
      </div>
      <div className="lb-meta">
        <span className="h-btn h-btn-light" style={{ pointerEvents: 'none' }}><Icon name="plus" size={16} /> New trade</span>
      </div>
    </button>
  )
}
