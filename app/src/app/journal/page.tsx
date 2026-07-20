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
import { JournalEmptyState } from './_components/JournalEmptyState'
import { MicroSurvey } from '@/app/_components/MicroSurvey'
import { MonthlyReportCard } from './_components/MonthlyReportCard'
import { RulesCard } from './_components/RulesCard'
import { MistakeAnalysisCard } from './_components/MistakeAnalysisCard'
import { getTradingRules } from '@/app/actions/rules'
import { analyzeCompliance, hasAnyRule, EMPTY_RULES, type RuleTrade } from '@/lib/rules'
import { computeWeeklyDetail } from '@/lib/weekly'
import { generateInsights } from '@/lib/insights'
import { InsightCards } from './_components/InsightCards'
import { LockedFeatures } from './_components/LockedFeatures'
import { EmotionCard } from './_components/EmotionCard'
import { GoalsCard } from './_components/GoalsCard'
import { getGoalsWithProgress } from '@/lib/server/goals'
import { createServiceClient } from '@/lib/supabase/service'
import { computeStreaks } from '@/lib/streaks'
import { StreaksCard } from './_components/StreaksCard'

export default async function JournalPage() {
  const supabase = await createClient()
  const user = await getSessionUser(supabase)
  if (!user) redirect('/login')

  const { data: all } = await supabase
    .from('trades')
    .select('id, instrument, market, direction, status, outcome, entry_price, exit_price, stop_price, r_multiple, pnl_amount, planned_rr, setup_type, strategy_tags, mistake_tags, emotion, traded_at, risk_percent, risk_amount, source')
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

  // Trading rules + compliance (rows 18/19). Rules gate on the same flag as
  // rule compliance; evaluate over closed trades that carry an r_multiple.
  const canRules = canFlag(flags, tier, 'trading_rules')
  const rules = canRules ? (await getTradingRules()) ?? EMPTY_RULES : EMPTY_RULES
  const ruleTrades: RuleTrade[] = (all ?? [])
    .filter((t) => t.status === 'closed' && t.r_multiple != null)
    .map((t) => ({
      tradedAt: t.traded_at,
      plannedRr: t.planned_rr,
      riskPercent: t.risk_percent,
      hasStop: t.stop_price != null,
      rMultiple: t.r_multiple,
      pnlAmount: t.pnl_amount,
    }))
  const compliance = canRules && hasAnyRule(rules) && ruleTrades.length > 0
    ? analyzeCompliance(rules, ruleTrades)
    : null

  // Process goals (row 24) — available to all tiers.
  const goals = await getGoalsWithProgress(
    createServiceClient(), user.id,
    (all ?? []).map((t) => ({
      traded_at: t.traded_at, planned_rr: t.planned_rr, risk_percent: t.risk_percent,
      stop_price: t.stop_price, r_multiple: t.r_multiple, status: t.status, mistake_tags: t.mistake_tags,
    })),
    rules,
  )

  // Meaningful streaks (row 34): process-based day sets.
  const svcForStreaks = createServiceClient()
  const [{ data: reviewEvents }, { data: lessonRows }] = await Promise.all([
    svcForStreaks.from('analytics_events').select('created_at').eq('user_id', user.id).eq('event', 'weekly_review_viewed').limit(2000),
    svcForStreaks.from('lesson_completions').select('completed_at').eq('user_id', user.id).limit(2000),
  ])
  const dayKey = (iso: string) => iso.slice(0, 10)
  const closedByDay = new Map<string, { total: number; clean: number }>()
  for (const t of (all ?? []).filter((t) => t.status === 'closed')) {
    const d = dayKey(t.traded_at)
    const e = closedByDay.get(d) ?? { total: 0, clean: 0 }
    e.total++
    if ((t.mistake_tags ?? []).length === 0) e.clean++
    closedByDay.set(d, e)
  }
  const streaks = computeStreaks({
    journalDays: [...new Set((all ?? []).map((t) => dayKey(t.traded_at)))],
    reviewDays: [...new Set((reviewEvents ?? []).map((r) => dayKey(r.created_at)))],
    compliantDays: [...closedByDay.entries()].filter(([, e]) => e.total > 0 && e.clean === e.total).map(([d]) => d),
    learningDays: [...new Set((lessonRows ?? []).map((r) => dayKey(r.completed_at)))],
    todayKey: new Date().toISOString().slice(0, 10),
  })

  // Personalised insights (row 22) — Pro tier (ai_insights flag).
  const canInsights = canFlag(flags, tier, 'ai_insights')
  const insights = canInsights
    ? generateInsights((all ?? []).filter((t) => t.status === 'closed').map((t) => ({
        rMultiple: t.r_multiple, pnlAmount: t.pnl_amount, tradedAt: t.traded_at,
        setupType: t.setup_type, strategyTags: t.strategy_tags ?? [], mistakeTags: t.mistake_tags ?? [],
      })))
    : []
  const asMetric = (t: JTrade): TradeForMetrics => ({
    status: t.status as 'open' | 'closed', outcome: t.outcome as TradeForMetrics['outcome'], rMultiple: t.r_multiple,
    pnlAmount: t.pnl_amount, tradedAt: t.traded_at, mistakeTags: [],
  })
  const thisWeekTrades = weekSlice(closed, 0)
  const thisWeekMetrics = computeMetrics(thisWeekTrades.map(asMetric))
  const lastWeekMetrics = computeMetrics(weekSlice(closed, 1).map(asMetric))

  // Enriched weekly detail (row 17): needs mistake_tags, which JTrade omits,
  // so pull from the raw rows filtered to this week's closed trades.
  const weekIds = new Set(thisWeekTrades.map((t) => t.id))
  const weeklyDetail = canWeeklyReview
    ? computeWeeklyDetail((all ?? []).filter((t) => weekIds.has(t.id)).map((t) => ({
        rMultiple: t.r_multiple, pnlAmount: t.pnl_amount, tradedAt: t.traded_at,
        strategyTags: t.strategy_tags ?? [], setupType: t.setup_type, mistakeTags: t.mistake_tags ?? [],
      })))
    : null
  const weekPnls = thisWeekTrades.map((t) => t.pnl_amount ?? 0)
  const bestTrade = weekPnls.length ? Math.max(...weekPnls) : null
  const worstTrade = weekPnls.length ? Math.min(...weekPnls) : null

  const thisMonthClosed = monthSlice(closed, 0)
  const lastMonthClosed = monthSlice(closed, 1)
  const monthInstCounts: Record<string, number> = {}
  for (const t of thisMonthClosed) monthInstCounts[t.instrument] = (monthInstCounts[t.instrument] ?? 0) + 1
  const topMonthInstrument = Object.entries(monthInstCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  // Gate flags for the cards that hide themselves when locked. Rather than
  // stacking eight upsell cards down a free user's journal, the locked ones
  // render nothing and get named once in a collapsed strip at the foot.
  const canMonthlyReport = canFlag(flags, tier, 'monthly_report')
  const canMistakes = canFlag(flags, tier, 'mistake_tagging')
  const canEmotion = canFlag(flags, tier, 'advanced_journal')
  const canStrategy = canFlag(flags, tier, 'strategy_breakdown')
  const canRisk = canFlag(flags, tier, 'risk_tracking')
  const lockedFeatures = ([
    [canInsights, 'Personalised insights', 'Pro'],
    [canWeeklyReview, 'Weekly performance review', 'Trader+'],
    [canMonthlyReport, 'Monthly trader report', 'Pro'],
    [canRules, 'Trading rules', 'Trader+'],
    [canMistakes, 'Mistake analysis', 'Trader+'],
    [canEmotion, 'Emotional state', 'Trader+'],
    [canStrategy, 'Strategy breakdown', 'Pro'],
    [canRisk, 'Risk management', 'Trader+'],
  ] as const)
    .filter(([allowed]) => !allowed)
    .map(([, name, planTier]) => ({ name, tier: planTier }))

  // Rich empty state (row 13): first-run journal shows the three data paths
  // and a sample insight instead of a wall of zeroed cards.
  if (trades.length === 0) {
    return (
      <main className="ts-page">
        <JournalHero monthLabel={monthLabel} monthTrades={0} monthNet={0} streak={0} />
        <JournalEmptyState canImport={canFlag(flags, tier, 'mt5_import')} />
      </main>
    )
  }

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

      {/* Micro-survey (row 27): fresh journals only — asked once per browser. */}
      {trades.length <= 3 && (
        <MicroSurvey
          surveyKey="first_trade"
          question="How easy was it to log this trade?"
          options={['Very easy', 'OK', 'Clunky']}
        />
      )}

      {canInsights && (
        <div className="mt-5">
          <InsightCards insights={insights} locked={false} />
        </div>
      )}

      {canWeeklyReview && (
        <div className="mt-5">
          <WeeklyReviewCard thisWeek={thisWeekMetrics} lastWeek={lastWeekMetrics} best={bestTrade} worst={worstTrade} detail={weeklyDetail} locked={false} />
        </div>
      )}

      {canMonthlyReport && (
        <div className="mt-5">
          <MonthlyReportCard thisMonth={thisMonthClosed} lastMonth={lastMonthClosed} label={monthLabelFor(0)} topInstrument={topMonthInstrument} locked={false} />
        </div>
      )}

      {canRules && (
        <div className="mt-5">
          <RulesCard rules={rules} compliance={compliance} locked={false} />
        </div>
      )}

      <div className="mt-5">
        <StreaksCard streaks={streaks} />
      </div>

      <div className="mt-5">
        <GoalsCard goals={goals} />
      </div>

      {canMistakes && (
        <div className="mt-5">
          <MistakeAnalysisCard trades={(all ?? []).filter((t) => t.status === 'closed')} locked={false} />
        </div>
      )}

      {canEmotion && (
        <div className="mt-5">
          <EmotionCard trades={(all ?? []).filter((t) => t.status === 'closed').map((t) => ({ emotion: t.emotion, rMultiple: t.r_multiple, pnlAmount: t.pnl_amount }))} locked={false} />
        </div>
      )}

      {canStrategy && (
        <div className="mt-5">
          <StrategyBreakdownCard closed={closed} locked={false} />
        </div>
      )}

      {canRisk && (
        <div className="mt-5">
          <RiskTrackingCard trades={(all ?? []) as unknown as RiskTrade[]} locked={false} />
        </div>
      )}

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

      {lockedFeatures.length > 0 && (
        <div className="mt-5">
          <LockedFeatures items={lockedFeatures} />
        </div>
      )}
    </main>
  )
}
