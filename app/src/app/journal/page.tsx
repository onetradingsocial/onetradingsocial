import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { computeMetrics, type TradeForMetrics } from '@/lib/trade'
import { StatsBar } from './_components/StatsBar'
import { TradeRow } from './_components/TradeRow'
import { TradeFilters } from './_components/TradeFilters'

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>
}) {
  const { filter = 'all' } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('account_currency, is_public, account_balance').eq('id', user.id).single()

  const { data: all } = await supabase
    .from('trades')
    .select('id, instrument, direction, status, outcome, entry_price, exit_price, pnl_amount, r_multiple, planned_rr, setup_type, strategy_tags, mistake_tags, traded_at')
    .eq('user_id', user.id)
    .order('traded_at', { ascending: false })

  const trades = all ?? []
  const metrics = computeMetrics(trades.map((t): TradeForMetrics => ({
    status: t.status as 'open' | 'closed', outcome: t.outcome, rMultiple: t.r_multiple,
    pnlAmount: t.pnl_amount, tradedAt: t.traded_at, mistakeTags: t.mistake_tags ?? [],
  })))
  const shown = trades.filter((t) => filter === 'all' ? true : t.status === filter)

  return (
    <main className="ts-page">
      <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <p className="eyebrow">Trade Journal</p>
          <h1 className="ts-h1 mt-2">Your trades</h1>
        </div>
        {/* "Log trade" capture modal is wired in here in Task 10 */}
      </div>

      <div className="mt-6"><StatsBar m={metrics} currency={profile?.account_currency ?? 'USD'} /></div>

      <div className="mt-7 flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <h2 className="ts-h2">Recent trades</h2>
        <TradeFilters active={filter} />
      </div>

      <div className="ts-card mt-3" style={{ padding: 8 }}>
        {shown.length === 0 ? (
          <p className="faint" style={{ padding: 24, textAlign: 'center' }}>No trades yet. Log your first trade.</p>
        ) : (
          <table className="ts-table">
            <thead>
              <tr><th>Instrument</th><th>Entry</th><th>Exit</th><th>P/L</th><th>R:R</th><th>Tags</th><th>Status</th></tr>
            </thead>
            <tbody>{shown.map((t) => <TradeRow key={t.id} t={t} />)}</tbody>
          </table>
        )}
      </div>
    </main>
  )
}
