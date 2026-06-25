'use client'

import { Icon } from './atoms'
import type { HomeData } from './types'

export function LogTradeBand({ data, onClick }: { data: HomeData; onClick: () => void }) {
  const { loggedToday } = data
  return (
    <button className="h-logband" onClick={onClick}>
      <div className="h-ink-grid" />
      <span className="lb-ic"><Icon name="bolt" size={28} /></span>
      <div className="lb-tx">
        <h2>Log a trade</h2>
        <p>Capture today&apos;s setups while they&apos;re fresh — every entry sharpens your edge and feeds your streak.</p>
      </div>
      <div className="lb-meta">
        <div className="lb-stat"><div className="v">{loggedToday}</div><div className="k">logged today</div></div>
        <div className="lb-div" />
        <span className="h-btn h-btn-light" style={{ pointerEvents: 'none' }}><Icon name="plus" size={16} /> New trade</span>
      </div>
    </button>
  )
}
