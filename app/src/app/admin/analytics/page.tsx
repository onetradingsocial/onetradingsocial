// app/src/app/admin/analytics/page.tsx
import { createServiceClient } from '@/lib/supabase/service'
import { getAnalytics } from '@/lib/server/analytics'
import { getFunnelDashboard } from '@/lib/server/funnel'
import { TrendBars } from './_components/TrendBars'
import { CompletionsList } from './_components/CompletionsList'
import { Meter, PageHead, Panel, Section, Stat, Stats } from '../_components/ui'

export const dynamic = 'force-dynamic'

function FunnelBars({ rows }: { rows: { step: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count))
  return (
    <Panel title="Signup → activation">
      {rows.map((r, i) => {
        const prev = i > 0 ? rows[i - 1].count : null
        const conv = prev && prev > 0 ? Math.round((r.count / prev) * 100) : null
        return (
          <Meter
            key={r.step}
            label={r.step}
            note={conv != null ? `${r.count} · ${conv}%` : r.count}
            pct={(r.count / max) * 100}
          />
        )
      })}
    </Panel>
  )
}

export default async function AnalyticsPage() {
  const supabase = createServiceClient()
  const [d, f] = await Promise.all([getAnalytics(supabase), getFunnelDashboard(supabase)])

  return (
    <>
      <PageHead
        title="Analytics"
        sub="Product health over the last 30 days. Every figure counts genuine users only — admins, the team, seeded demo accounts and automated test signups are filtered out."
        right={<span className="v-badge vb-broker">Internal excluded</span>}
      />

      <div className="ad-stack">
        <Section title="Core funnel" sub="Each bar is measured against the step above it — the sharpest drop is where to spend the next sprint.">
          <FunnelBars rows={f.funnel} />
          {f.onboardingSteps.length > 0 && (
            <Panel title="Onboarding step reach">
              <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
                {f.onboardingSteps.map((s) => (
                  <span key={s.step} style={{ fontSize: 13.5 }}>
                    <span className="faint">Step {s.step}</span>{' '}
                    <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{s.count}</strong>
                  </span>
                ))}
              </div>
            </Panel>
          )}
        </Section>

        <Section title="Lifecycle">
          <Stats>
            {f.lifecycle.map((l) => <Stat key={l.status} label={l.status} value={l.count} />)}
          </Stats>
        </Section>

        <Section title="Acquisition">
          <Panel title="Signups by source" flush>
            {f.sources.map((s) => (
              <div key={s.source} className="ad-row">
                <code className="ad-kv">{s.source}</code>
                <span className="sp faint" style={{ fontVariantNumeric: 'tabular-nums' }}>{s.count}</span>
              </div>
            ))}
          </Panel>
        </Section>

        <Section title="Feature adoption" sub="Share of activated users who have used each feature at least once.">
          <Panel>
            {f.adoption.map((a) => (
              <Meter key={a.feature} label={a.feature} note={`${a.users} · ${a.pct}%`} pct={a.pct} />
            ))}
          </Panel>
        </Section>

        <Section title="Errors">
          <Stats>
            <Stat label="404 hits" value={f.notFound30d} tone={f.notFound30d > 0 ? 'warn' : undefined} />
            <Stat label="Client errors" value={f.clientErrors30d} tone={f.clientErrors30d > 0 ? 'warn' : undefined} />
          </Stats>
          {f.topBrokenPaths.length > 0 && (
            <Panel title="Top broken paths" flush>
              {f.topBrokenPaths.map((p) => (
                <div key={p.path} className="ad-row">
                  <code className="ad-kv" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.path}</code>
                  <span className="sp faint" style={{ fontVariantNumeric: 'tabular-nums' }}>{p.count}</span>
                </div>
              ))}
            </Panel>
          )}
        </Section>

        <Section title="Growth">
          <Stats>
            <Stat label="Total users" value={d.growth.totalUsers} tone="accent" />
            <Stat label="New (7d)" value={d.growth.new7d} />
            <Stat label="New (30d)" value={d.growth.new30d} />
          </Stats>
          <TrendBars title="Signups / week" data={d.growth.signupsPerWeek} />
        </Section>

        <Section title="Engagement">
          <Stats>
            <Stat label="Active users (7d)" value={d.engagement.active7d} />
            <Stat label="Active users (30d)" value={d.engagement.active30d} />
            <Stat label="Trades logged" value={d.engagement.totalTrades} />
          </Stats>
          <TrendBars title="Trades / week" data={d.engagement.tradesPerWeek} />
          <TrendBars title="Posts / week" data={d.engagement.postsPerWeek} />
          <TrendBars title="Social actions / week" data={d.engagement.socialPerWeek} />
        </Section>

        <Section title="Content">
          <Stats>
            <Stat label="Course completions" value={d.content.totalCompletions} />
            <Stat label="Published lessons" value={d.content.publishedLessons} />
            <Stat label="Leaderboard participants" value={d.content.leaderboardParticipants} />
          </Stats>
          <TrendBars title="Completions / week" data={d.content.completionsPerWeek} />
          <Panel title="Top courses">
            <CompletionsList rows={d.content.topCourses} />
          </Panel>
        </Section>

        <Section title="Ops">
          <Stats>
            <Stat label="Feedback total" value={d.ops.totalFeedback} />
            <Stat label="Open" value={d.ops.openFeedback} tone={d.ops.openFeedback > 0 ? 'warn' : undefined} />
            <Stat label="Triaged" value={d.ops.triagedFeedback} />
            <Stat label="Resolved" value={d.ops.closedFeedback} />
          </Stats>
          <TrendBars title="Feedback / week" data={d.ops.feedbackPerWeek} />
        </Section>
      </div>
    </>
  )
}
