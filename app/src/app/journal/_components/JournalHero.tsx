import { NewTradeButton } from '@/app/_components/NewTradeButton'

export function JournalHero({ monthLabel, monthTrades, monthNet, streak }: {
  monthLabel: string; monthTrades: number; monthNet: number; streak: number
}) {
  const sign = monthNet >= 0 ? '+' : '−'
  const money = `${sign}$${Math.abs(monthNet).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  return (
    <div className="ts-hero">
      <div className="ts-hero-glow" />
      <div className="ts-hero-main">
        <p className="ts-hero-eyebrow">Trade Journal · {monthLabel}</p>
        <h1 className="ts-hero-title">Capture the setup while it&rsquo;s fresh.</h1>
        <p className="ts-hero-sub">
          Your {monthLabel.split(' ')[0]} so far: <b>{monthTrades} trade{monthTrades === 1 ? '' : 's'}</b> logged, <b>{money}</b> net
          {streak !== 0 ? <> and a <b>{Math.abs(streak)}-day {streak > 0 ? 'green' : 'red'} streak</b></> : null}. Log the next one before the details fade.
        </p>
      </div>
      <div className="ts-hero-stats">
        <div className="ts-hero-stat"><div className="n">{monthTrades}</div><div className="l">Trades · {monthLabel.slice(0, 3)}</div></div>
        <div className="ts-hero-stat"><div className="n">{money}</div><div className="l">Net P/L</div></div>
        <NewTradeButton className="btn btn-onband" label="+ New Entry" />
      </div>
    </div>
  )
}
