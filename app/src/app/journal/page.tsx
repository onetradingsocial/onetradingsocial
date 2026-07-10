import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient, getSessionUser } from '@/lib/supabase/server'
import { computeMetrics, type TradeForMetrics } from '@/lib/trade'
import { monthlyPnl, equityCurve, assetDistribution, calendarCells, periodSums, weekSlice, monthSlice, monthLabel as monthLabelFor, MONTHS, type JTrade } from '@/lib/journal-stats'
import { getTier } from '@/lib/server/entitlements'
import { JOURNAL_FREE_LIMIT } from '@/lib/entitlements'
import { canFlag } from '@/lib/feature-flags'
import { getFeatureFlags } from '@/lib/server/feature-flags'
import { JournalHero } from './_components/JournalHero'
import { StatCards } from './_components/StatCards'
import { MonthlyPL } from './_components/MonthlyPL'
import { EquityCurve } from './_components/EquityCurve'
import { AssetDonut } from './_components/AssetDonut'
import { TradingCalendar } from './_components/TradingCalendar'
import { RecentTrades } from './_components/RecentTrades'
import { JournalExportButtons } from './_components/JournalExportButtons'
import { WeeklyReviewCard } from './_components/WeeklyReviewCard'
import { StrategyBreakdownCard } from './_components/StrategyBreakdownCard'
import { RiskTrackingCard, type RiskTrade } from './_components/RiskTrackingCard'
import { MonthlyReportCard } from './_components/MonthlyReportCard'

export default async function JournalPage() {
  const supabase = await createClient()
  const user = await getSessionUser(supabase)
  if (!user) redirect('/login')

  const { data: all } = await supabase
    .from('trades')
    .select('id, instrument, market, direction, status, outcome, entry_price, exit_price, r_multiple, pnl_amount, planned_rr, setup_type, strategy_tags, traded_at, risk_percent, risk_amount')
    .eq('user_id', user.id)
    .order('traded_at', { ascending: false })

  const { data: prof } = await supabase
    .from('profiles').select('account_balance').eq('id', user.id).single()
  const noBalance = !prof?.account_balance

  const trades = (all ?? []) as JTrade[]
  const closed = trades.filter((t) => t.status === 'closed')

  const tier = await getTier(supabase, user.id)
  const flags = await getFeatureFlags()
  const unlimited = canFlag(flags, tier, 'journal_unlimited')
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

  const canWeeklyReview = canFlag(flags, tier, 'weekly_review')
  const asMetric = (t: JTrade): TradeForMetrics => ({
    status: t.status as 'open' | 'closed', outcome: t.outcome as TradeForMetrics['outcome'], rMultiple: t.r_multiple,
    pnlAmount: t.pnl_amount, tradedAt: t.traded_at, mistakeTags: [],
  })
  const thisWeekTrades = weekSlice(closed, 0)
  const thisWeekMetrics = computeMetrics(thisWeekTrades.map(asMetric))
  const lastWeekMetrics = computeMetrics(weekSlice(closed, 1).map(asMetric))
  const weekPnls = thisWeekTrades.map((t) => t.pnl_amount ?? 0)
  const bestTrade = weekPnls.length ? Math.max(...weekPnls) : null
  const worstTrade = weekPnls.length ? Math.min(...weekPnls) : null

  const thisMonthClosed = monthSlice(closed, 0)
  const lastMonthClosed = monthSlice(closed, 1)
  const monthInstCounts: Record<string, number> = {}
  for (const t of thisMonthClosed) monthInstCounts[t.instrument] = (monthInstCounts[t.instrument] ?? 0) + 1
  const topMonthInstrument = Object.entries(monthInstCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

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
        <StatCards metrics={metrics} allTime={sums.allTime} monthNet={sums.monthNet} monthLabel={monthLabel} weekTrades={sums.weekTrades} advanced={canFlag(flags, tier, 'advanced_stats')} />
      </div>

      <div className="mt-5">
        <WeeklyReviewCard thisWeek={thisWeekMetrics} lastWeek={lastWeekMetrics} best={bestTrade} worst={worstTrade} locked={!canWeeklyReview} />
      </div>

      <div className="mt-5">
        <MonthlyReportCard thisMonth={thisMonthClosed} lastMonth={lastMonthClosed} label={monthLabelFor(0)} topInstrument={topMonthInstrument} locked={!canFlag(flags, tier, 'monthly_report')} />
      </div>

      <div className="mt-5">
        <StrategyBreakdownCard closed={closed} locked={!canFlag(flags, tier, 'strategy_breakdown')} />
      </div>

      <div className="mt-5">
        <RiskTrackingCard trades={(all ?? []) as unknown as RiskTrade[]} locked={!canFlag(flags, tier, 'risk_tracking')} />
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
        <TradingCalendar cells={cal} monthLabel={monthLabel} today={now.getDate()} trades={trades} year={year} month={month} />
      </div>

      <div className="mt-5 flex items-center justify-end">
        <JournalExportButtons trades={trades} canExport={canFlag(flags, tier, 'export_journal')} canReport={canFlag(flags, tier, 'advanced_reporting')} />
      </div>

      <div className="mt-3">
        <RecentTrades trades={visibleTrades} monthNet={sums.monthNet} canMistakeTag={canFlag(flags, tier, 'mistake_tagging')} />
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
