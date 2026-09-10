import Link from 'next/link'
import type { Metrics } from '@/lib/trade'
import { compareWeeks, type WeeklyDetail } from '@/lib/weekly'
import { TrackOnMount } from '@/app/_components/TrackOnMount'
import { MicroSurvey } from '@/app/_components/MicroSurvey'

function money(n: number, sign = false) {
  const abs = `$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  return n < 0 ? `−${abs}` : sign ? `+${abs}` : abs
}

/**
 * A change, or an honest statement that there isn't one.
 *
 * `value` is nullable on purpose — see `compareWeeks`. A null must never render
 * as an arrow, and must never render as "flat" either: "flat vs last week" is a
 * claim that this week matched last week, which is a different (and false)
 * thing to say about a week with no trades in it.
 */
function Delta({ value, suffix = '', good = true }: { value: number | null; suffix?: string; good?: boolean }) {
  if (value == null) return <span className="faint" style={{ fontSize: 12 }}>no comparison</span>
  if (Math.abs(value) < 0.005) return <span className="faint" style={{ fontSize: 12 }}>flat vs last week</span>
  const up = value > 0
  const positive = good ? up : !up
  return (
    <span style={{ fontSize: 12, fontWeight: 700, color: positive ? 'var(--up-ink)' : 'var(--down-ink)' }}>
      {up ? '▲' : '▼'} {Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 1 })}{suffix} vs last week
    </span>
  )
}

const totals = (m: Metrics) => ({
  total: m.total, netPnl: m.netPnl, winRate: m.winRate, avgRr: m.avgRr, rCount: m.rCount,
})

export function WeeklyReviewCard({ thisWeek, lastWeek, best, worst, detail = null, locked, interactive = true }: {
  thisWeek: Metrics; lastWeek: Metrics; best: number | null; worst: number | null; locked: boolean
  /** enriched summary (strategy/session/mistake/drawdown + continue/change) */
  detail?: WeeklyDetail | null
  /** false on the public demo page: no tracking, no survey */
  interactive?: boolean
}) {
  // Locked cards render nothing — LockedFeatures lists them once at the page foot.
  if (locked) return null

  const cmp = compareWeeks(totals(thisWeek), totals(lastWeek))
  const dPnl = cmp.deltas.netPnl
  const dTrades = cmp.deltas.trades
  const dWinRate = cmp.deltas.winRate == null ? null : cmp.deltas.winRate * 100

  // P0: a current window with no trades gets a "Not enough data" state, never a
  // grid of zeros with green arrows on it. Nothing in here reports a change,
  // because there is nothing to report a change about.
  if (cmp.emptyReason) {
    return (
      <div className="ts-card">
        {interactive && <TrackOnMount event="weekly_review_viewed" />}
        <div className="flex items-center justify-between">
          <h2 className="ts-h2">Weekly performance review</h2>
          <span className="faint" style={{ fontSize: 12 }}>Last 7 days vs the 7 before · by trade date</span>
        </div>
        <p className="faint mt-3" style={{ fontSize: 13.5, lineHeight: 1.6, maxWidth: 620 }}>
          <b style={{ display: 'block', color: 'var(--text)' }}>Not enough data for this week&apos;s review.</b>
          No closed trades dated in the last 7 days.{' '}
          {cmp.hasPrevious
            ? `Your previous 7 days closed ${lastWeek.total} ${lastWeek.total === 1 ? 'trade' : 'trades'}, but a week with nothing in it is not an improvement on it — so nothing here is compared.`
            : 'There is no previous week to compare against either.'}
        </p>
        <ul className="faint mt-3" style={{ fontSize: 13.5, lineHeight: 1.7, paddingLeft: 18, margin: 0, maxWidth: 620 }}>
          <li>
            <Link href="#recent-trades" style={{ color: 'var(--violet-br)', fontWeight: 700 }}>Review your past trades</Link>
            {' '}— last week&apos;s losers still have lessons in them.
          </li>
          <li>
            Sat out on purpose? That is a result, not a gap. Note the reason in
            your journal so next week&apos;s review has the decision on record.
          </li>
        </ul>
      </div>
    )
  }

  return (
    <div className="ts-card">
      {interactive && <TrackOnMount event="weekly_review_viewed" />}
      <div className="flex items-center justify-between">
        <h2 className="ts-h2">Weekly performance review</h2>
        <span className="faint" style={{ fontSize: 12 }}>Last 7 days vs the 7 before · closed, by trade date</span>
      </div>
      {!cmp.hasPrevious && (
        <p className="faint mt-2" style={{ fontSize: 12.5 }}>
          No closed trades dated in the previous 7 days, so this week stands on its own — nothing below is a comparison.
        </p>
      )}
      <div className="ts-cards5 mt-3">
        <div className="ts-bigcard" data-tone="blue">
          <div className="ts-bigcard-top"><span>Trades</span><span className="ts-bigcard-icon">▤</span></div>
          <div className="ts-bigcard-val">{thisWeek.total}</div>
          <div className="ts-bigcard-sub"><Delta value={dTrades} /></div>
          <div className="ts-bigcard-foot">closed · trade date in last 7 days</div>
        </div>
        <div className="ts-bigcard" data-tone="green">
          <div className="ts-bigcard-top"><span>Net P/L</span><span className="ts-bigcard-icon">💳</span></div>
          <div className="ts-bigcard-val">{money(thisWeek.netPnl, true)}</div>
          <div className="ts-bigcard-sub"><Delta value={dPnl} /></div>
          <div className="ts-bigcard-foot">closed · realised money</div>
        </div>
        <div className="ts-bigcard" data-tone="violet">
          <div className="ts-bigcard-top"><span>Win Rate</span><span className="ts-bigcard-icon">✓</span></div>
          <div className="ts-bigcard-val">{Math.round(thisWeek.winRate * 100)}%</div>
          <div className="ts-bigcard-sub"><Delta value={dWinRate} suffix="pts" /></div>
          <div className="ts-bigcard-foot">by outcome · n={thisWeek.total} closed</div>
        </div>
        <div className="ts-bigcard" data-tone="gold">
          <div className="ts-bigcard-top"><span>Best trade</span><span className="ts-bigcard-icon">🏆</span></div>
          <div className="ts-bigcard-val">{best != null ? money(best, true) : '—'}</div>
          <div className="ts-bigcard-sub faint">last 7 days</div>
          <div className="ts-bigcard-foot">single closed trade · money</div>
        </div>
        <div className="ts-bigcard" data-tone="sky">
          <div className="ts-bigcard-top"><span>Worst trade</span><span className="ts-bigcard-icon">⚠</span></div>
          <div className="ts-bigcard-val">{worst != null ? money(worst, true) : '—'}</div>
          <div className="ts-bigcard-sub faint">last 7 days</div>
          <div className="ts-bigcard-foot">single closed trade · money</div>
        </div>
      </div>

      {detail && (
        <>
          <div className="ts-compute mt-4">
            <div className="ts-compute-cell"><div className="k">Profit factor (R) · n={thisWeek.rCount}</div>
              <div className="v">{thisWeek.profitFactor === Infinity ? '∞' : thisWeek.profitFactor.toFixed(2)}</div></div>
            <div className="ts-compute-div" />
            <div className="ts-compute-cell"><div className="k">Avg winner / loser · realised R</div>
              <div className="v">{detail.avgWinner.toFixed(1)}R / {detail.avgLoser.toFixed(1)}R</div></div>
            <div className="ts-compute-div" />
            <div className="ts-compute-cell"><div className="k">Max drawdown · cumulative R</div>
              <div className="v ts-neg">{detail.maxDrawdownR.toFixed(1)}R</div></div>
          </div>

          <div className="ts-grid3 mt-4">
            <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '10px 14px' }}>
              <div className="faint" style={{ fontSize: 12 }}>Best strategy</div>
              <div style={{ fontWeight: 700, marginTop: 3 }}>{detail.bestStrategy ? `${detail.bestStrategy.name} · ${money(detail.bestStrategy.pnl, true)}` : '—'}</div>
            </div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '10px 14px' }}>
              <div className="faint" style={{ fontSize: 12 }}>Best session</div>
              <div style={{ fontWeight: 700, marginTop: 3 }}>{detail.bestSession ? `${detail.bestSession.name} · ${money(detail.bestSession.pnl, true)}` : '—'}</div>
            </div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '10px 14px' }}>
              <div className="faint" style={{ fontSize: 12 }}>Most expensive mistake</div>
              <div style={{ fontWeight: 700, marginTop: 3 }}>{detail.worstMistake ? `${detail.worstMistake.tag} · ${money(detail.worstMistake.cost)}` : 'None tagged'}</div>
            </div>
          </div>

          <div className="ts-grid2 mt-4">
            <div style={{ borderRadius: 12, padding: '12px 14px', background: 'var(--up-soft)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--up)' }}>✓ Continue</div>
              <p style={{ margin: '4px 0 0', fontSize: 13.5 }}>{detail.continueMsg}</p>
            </div>
            <div style={{ borderRadius: 12, padding: '12px 14px', background: 'var(--down-soft)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--down)' }}>△ Change</div>
              <p style={{ margin: '4px 0 0', fontSize: 13.5 }}>{detail.changeMsg}</p>
            </div>
          </div>
        </>
      )}
      {interactive && thisWeek.total > 0 && (
        <MicroSurvey
          surveyKey="first_weekly_report"
          question="Did this report reveal anything useful?"
          options={['Yes, genuinely', 'Somewhat', 'Not really']}
        />
      )}
    </div>
  )
}
