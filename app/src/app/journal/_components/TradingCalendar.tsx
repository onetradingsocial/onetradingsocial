import type { CalCell } from '@/lib/journal-stats'

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function TradingCalendar({ cells, monthLabel, today }: { cells: CalCell[]; monthLabel: string; today: number }) {
  return (
    <div className="ts-card">
      <div className="flex items-center justify-between">
        <h2 className="ts-h2">Trading Calendar</h2>
        <span className="faint">{monthLabel}</span>
      </div>
      <div className="ts-cal mt-4">
        {DOW.map((d) => <div key={d} className="ts-cal-dow">{d}</div>)}
        {cells.map((c, i) => {
          const tone = !c.inMonth ? 'out' : c.count === 0 ? 'empty' : c.pnl >= 0 ? 'pos' : 'neg'
          const isToday = c.inMonth && c.day === today
          return (
            <div key={i} className="ts-cal-cell" data-tone={tone} data-today={isToday}>
              <div className="d">{c.day}{isToday && <span className="ts-cal-today">TODAY</span>}</div>
              {c.inMonth && c.count > 0 && (
                <div className="m">
                  <span className={c.pnl >= 0 ? 'ts-pos' : 'ts-neg'}>{c.pnl >= 0 ? '+' : '−'}${Math.abs(c.pnl).toFixed(0)}</span>
                  <span className="ct">{c.count} trade{c.count > 1 ? 's' : ''}</span>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="ts-cal-legend">
        <span><i className="pos" /> Profitable day</span>
        <span><i className="neg" /> Losing day</span>
        <span><i className="today" /> Today</span>
      </div>
    </div>
  )
}
