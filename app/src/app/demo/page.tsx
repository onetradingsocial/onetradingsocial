// Demo pathway (Sprint 2, row 12): a populated example journal + weekly
// review, browsable WITHOUT connecting an account or signing up. Public route.
import type { Metadata } from 'next'
import Link from 'next/link'
import { computeMetrics, type TradeForMetrics } from '@/lib/trade'
import { StatCards } from '@/app/journal/_components/StatCards'
import { WeeklyReviewCard } from '@/app/journal/_components/WeeklyReviewCard'
import { RecentTrades } from '@/app/journal/_components/RecentTrades'
import { VerificationBadge } from '@/app/_components/VerificationBadge'
import type { JTrade } from '@/lib/journal-stats'

export const metadata: Metadata = {
  title: 'Demo journal — TradingSocial',
  description: 'Explore a populated TradingSocial journal — stats, weekly review and trade log — before connecting anything.',
}

// Deterministic sample data: realistic mix of wins/losses across 6 weeks.
const SPECS: [string, string, number, number, number, number][] = [
  // [instrument, market, entry, exit, rMultiple, pnl]
  ['EUR/USD', 'forex', 1.0842, 1.0895, 2.1, 210], ['GBP/JPY', 'forex', 191.42, 190.71, -1.0, -100],
  ['XAU/USD', 'commodities', 2321.5, 2338.2, 1.7, 170], ['NAS100', 'indices', 18320, 18455, 1.4, 140],
  ['EUR/USD', 'forex', 1.0791, 1.0762, -1.0, -100], ['BTC/USD', 'crypto', 61250, 63180, 1.9, 190],
  ['US30', 'indices', 38900, 38740, -0.8, -80], ['GBP/USD', 'forex', 1.2704, 1.2762, 2.3, 230],
  ['XAU/USD', 'commodities', 2344.8, 2334.1, -1.0, -100], ['EUR/USD', 'forex', 1.0825, 1.0871, 1.8, 180],
  ['ETH/USD', 'crypto', 3390, 3312, -1.0, -100], ['NAS100', 'indices', 18510, 18688, 1.6, 160],
  ['USD/JPY', 'forex', 154.82, 155.4, 1.2, 120], ['GBP/JPY', 'forex', 192.1, 193.05, 1.9, 190],
  ['EUR/USD', 'forex', 1.0888, 1.0851, -1.1, -110], ['XAU/USD', 'commodities', 2352.4, 2377.9, 2.5, 250],
  ['BTC/USD', 'crypto', 64100, 63020, -0.9, -90], ['US30', 'indices', 39120, 39310, 1.3, 130],
  ['GBP/USD', 'forex', 1.2731, 1.2698, -1.0, -100], ['EUR/USD', 'forex', 1.0799, 1.0846, 1.9, 190],
]

function demoTrades(): JTrade[] {
  const now = Date.now()
  return SPECS.map(([instrument, market, entry, exit, r, pnl], i) => {
    const daysAgo = (SPECS.length - i) * 2.2
    const t = new Date(now - daysAgo * 864e5)
    return {
      id: `demo-${i}`, instrument, market,
      direction: exit >= entry ? 'long' : 'short',
      status: 'closed', outcome: pnl > 0 ? 'win' : 'loss',
      entry_price: entry, exit_price: exit, r_multiple: r, pnl_amount: pnl,
      planned_rr: Math.abs(r) + 0.4,
      setup_type: ['Breakout', 'Retest', 'Trend Continuation'][i % 3],
      strategy_tags: [['London breakout'], ['NY reversal'], ['Swing']][i % 3],
      traded_at: t.toISOString(),
      source: (['broker', 'statement', 'manual'] as const)[i % 3],
    }
  })
}

export default function DemoJournalPage() {
  const trades = demoTrades()
  const asMetric = (t: JTrade): TradeForMetrics => ({
    status: 'closed', outcome: t.outcome as TradeForMetrics['outcome'],
    rMultiple: t.r_multiple, pnlAmount: t.pnl_amount, tradedAt: t.traded_at, mistakeTags: [],
  })
  const metrics = computeMetrics(trades.map(asMetric))
  const week = (n: number) => trades.filter((t) => {
    const age = (Date.now() - Date.parse(t.traded_at)) / 864e5
    return age >= n * 7 && age < (n + 1) * 7
  })
  const thisWeek = computeMetrics(week(0).map(asMetric))
  const lastWeek = computeMetrics(week(1).map(asMetric))
  const weekPnls = week(0).map((t) => t.pnl_amount ?? 0)
  const monthNet = trades.reduce((s, t) => s + (t.pnl_amount ?? 0), 0)

  return (
    <main className="ts-page">
      <div className="ts-card" style={{ padding: '18px 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 className="ts-h1" style={{ fontSize: 24 }}>Demo journal</h1>
          <p className="ts-sub">
            Sample data — this is what your journal looks like once trades flow in. Notice the{' '}
            <VerificationBadge level="broker_connected" short /> <VerificationBadge level="statement_imported" short /> <VerificationBadge level="self_reported" short /> badges: verification travels with every trade.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link href="/signup" className="btn btn-primary">Create free account</Link>
          <Link href="/leaderboard" className="btn">See real traders</Link>
        </div>
      </div>

      <div className="mt-5">
        <StatCards metrics={metrics} allTime={monthNet} monthNet={monthNet} monthLabel="Sample period" weekTrades={week(0).length} advanced />
      </div>

      <div className="mt-5">
        <WeeklyReviewCard
          thisWeek={thisWeek} lastWeek={lastWeek}
          best={weekPnls.length ? Math.max(...weekPnls) : null}
          worst={weekPnls.length ? Math.min(...weekPnls) : null}
          locked={false}
          interactive={false}
        />
      </div>

      <div className="mt-5">
        <RecentTrades trades={trades} monthNet={monthNet} />
      </div>

      <div className="ts-card mt-5" style={{ textAlign: 'center', padding: '26px 20px' }}>
        <h2 className="ts-h2">Ready to see your own numbers?</h2>
        <p className="ts-sub mt-2">Log your first trade in under a minute — or import your MT5 history in one upload.</p>
        <div className="mt-4" style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <Link href="/signup" className="btn btn-primary">Start free</Link>
          <Link href="/verification" className="btn">How verification works</Link>
        </div>
      </div>
    </main>
  )
}
