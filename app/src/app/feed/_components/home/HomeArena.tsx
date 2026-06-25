'use client'

import './home-arena.css'
import { useTradeModal } from '@/app/_components/TradeModalProvider'
import { CmdArena } from './CmdArena'
import { StatRow } from './StatRow'
import { LogTradeBand } from './LogTradeBand'
import { ArenaFeed } from './ArenaFeed'
import { Rail } from './rail'
import type { HomeData } from './types'

export function HomeArena({ data }: { data: HomeData }) {
  const { open } = useTradeModal()
  return (
    <div className="h-app">
      <div className="h-main">
        <div className="h-col" style={{ gap: 22 }}>
          <CmdArena data={data} onOpenTrade={open} />
          <StatRow data={data} />
          <LogTradeBand data={data} onClick={open} />
          <div className="h-grid">
            <ArenaFeed data={data} />
            <Rail data={data} />
          </div>
        </div>
      </div>
    </div>
  )
}
