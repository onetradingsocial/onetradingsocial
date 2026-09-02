import { Empty, Panel, When } from '../../_components/ui'
import { needsAttention, runHealth, topFailure, totalProcessed } from '@/lib/cron-health'
import { toCounters, type CronRunRow } from '@/lib/server/cron-runs'

const TONE: Record<string, { label: string; className: string }> = {
  ok: { label: 'delivered', className: 'v-badge vb-broker' },
  idle: { label: 'nothing due', className: 'v-badge vb-self' },
  degraded: { label: 'partial', className: 'v-badge vb-pending' },
  failed: { label: 'none delivered', className: 'v-badge vb-failed' },
  no_provider: { label: 'no provider', className: 'v-badge vb-failed' },
}

/**
 * The last fortnight of lifecycle-email runs.
 *
 * This panel is the point of migration 0065. Persisting the counters without
 * somewhere to read them would repeat the fault the plan already names — "the
 * funnel that nobody reads is the same as no funnel, at higher build cost".
 *
 * Each row answers the question that could not be answered the morning after
 * the first run: how many messages actually left, and if some did not, why.
 */
export function CronRuns({ rows }: { rows: CronRunRow[] }) {
  if (rows.length === 0) {
    return (
      <Panel title="Lifecycle email runs">
        <Empty>
          No runs recorded yet. The cron writes one row per execution once migration 0065 is
          applied; until then this stays empty and nothing else is affected.
        </Empty>
      </Panel>
    )
  }

  return (
    <Panel title="Lifecycle email runs" flush scroll>
      {rows.map((row) => {
        const c = toCounters(row)
        const health = runHealth(c)
        const tone = TONE[health] ?? TONE.idle
        const worst = topFailure(c.failures)
        return (
          <div key={row.ran_at} className="ad-row">
            <When iso={row.ran_at} short />
            <span className={tone.className} style={{ marginLeft: 10 }}>{tone.label}</span>
            <span className="sp faint" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {c.delivered} sent
              {c.undelivered > 0 && <> · {c.undelivered} failed</>}
              {' · '}
              {totalProcessed(c.processed)} processed
            </span>
            {worst && needsAttention(health) && (
              <code className="ad-kv" style={{ marginLeft: 10 }}>
                {worst.reason} ×{worst.count}
              </code>
            )}
          </div>
        )
      })}
    </Panel>
  )
}
