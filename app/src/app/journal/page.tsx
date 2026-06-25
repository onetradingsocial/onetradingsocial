import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient, getSessionUser } from '@/lib/supabase/server'
import { computeMetrics, type TradeForMetrics } from '@/lib/trade'
import { monthlyPnl, equityCurve, assetDistribution, calendarCells, periodSums, MONTHS, type JTrade } from '@/lib/journal-stats'
import { getTier } from '@/lib/server/entitlements'
import { JOURNAL_FREE_LIMIT, can } from '@/lib/entitlements'
import { JournalHero } from './_components/JournalHero'
import { StatCards } from './_components/StatCards'
import { MonthlyPL } from './_components/MonthlyPL'
import { EquityCurve } from './_components/EquityCurve'
import { AssetDonut } from './_components/AssetDonut'
import { TradingCalendar } from './_components/TradingCalendar'
import { RecentTrades } from './_components/RecentTrades'

export default async function JournalPage() {
  const supabase = await createClient()
  const user = await getSessionUser(supabase)
  if (!user) redirect('/login')

  const { data: all } = await supabase
    .from('trades')
    .select('id, instrument, market, direction, status, outcome, entry_price, exit_price, r_multiple, pnl_amount, planned_rr, setup_type, strategy_tags, traded_at')
    .eq('user_id', user.id)
    .order('traded_at', { ascending: false })

  const { data: prof } = await supabase
    .from('profiles').select('account_balance').eq('id', user.id).single()
  const noBalance = !prof?.account_balance

  const trades = (all ?? []) as JTrade[]
  const closed = trades.filter((t) => t.status === 'closed')

  const tier = await getTier(supabase, user.id)
  const unlimited = can(tier, 'journal_unlimited')
  const visibleTrades = unlimited ? trades : trades.slice(0, JOURNAL_FREE_LIMIT)
  const hiddenCount = trades.length - visibleTrades.length

  const now = new Date()
  const year = now.getFullYear(), month = now.getMonth()
  const monthLabel = `${MONTHS[month]} ${year}`

  const metrics = computeMetrics(trades.map((t): TradeForMetrics => ({
    status: t.status as 'open' | 'closed', outcome: t.outcome as TradeForMetrics['outcome'], rMultiple: t.r_multiple,
    pnlAmount: t.pnl_amount, tradedAt: t.traded_at, mistakeTags: [],
  })))
  const sums = periodSums(closed, year, month)
  const eq = equityCurve(closed)
  const dist = assetDistribution(trades)
  const cal = calendarCells(trades, year, month)

  return (
    <main className="ts-page">
      <JournalHero monthLabel={monthLabel} monthTrades={sums.monthTrades} monthNet={sums.monthNet} streak={metrics.currentStreak} />

      {noBalance && (
        <div className="ts-banner mt-5">
          <span>💡 Set your <b>account balance</b> in{' '}
            <Link href="/settings" style={{ color: 'var(--violet-br)', fontWeight: 700 }}>Settings</Link>{' '}
            to see P/L in money. R-multiples and win rate already work.</span>
        </div>
      )}

      <div className="mt-5">
        <StatCards metrics={metrics} allTime={sums.allTime} monthNet={sums.monthNet} monthLabel={monthLabel} weekTrades={sums.weekTrades} advanced={can(tier, 'advanced_stats')} />
      </div>

      <div className="ts-panels mt-5">
        <div className="ts-card">
          <div className="flex items-center justify-between"><h2 className="ts-h2">Monthly P/L</h2><span className="faint">{year}</span></div>
          <div className="mt-3"><MonthlyPL data={monthlyPnl(closed, year)} /></div>
        </div>
        <div className="ts-card">
          <div className="flex items-center justify-between"><h2 className="ts-h2">Equity Curve</h2><span className="faint">YTD</span></div>
          <div className="mt-3"><EquityCurve points={eq.points} final={eq.final} /></div>
        </div>
        <div className="ts-card">
          <div className="flex items-center justify-between"><h2 className="ts-h2">Asset Distribution</h2><span className="faint">by volume</span></div>
          <div className="mt-3"><AssetDonut data={dist} total={trades.length} /></div>
        </div>
      </div>

      <div className="mt-5">
        <TradingCalendar cells={cal} monthLabel={monthLabel} today={now.getDate()} />
      </div>

      <div className="mt-5">
        <RecentTrades trades={visibleTrades} monthNet={sums.monthNet} />
        {hiddenCount > 0 && (
          <div className="ts-banner mt-3">
            Showing your last {JOURNAL_FREE_LIMIT} trades. {hiddenCount} older{' '}
            {hiddenCount === 1 ? 'trade is' : 'trades are'} hidden on Free — nothing is deleted.{' '}
            <a href="/settings/billing" style={{ color: 'var(--violet-br)', fontWeight: 700 }}>Upgrade</a>{' '}
            to see your full history.
          </div>
        )}
      </div>
    </main>
  )
}
