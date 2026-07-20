// app/src/app/admin/analytics/page.tsx
import { createServiceClient } from '@/lib/supabase/service'
import { getAnalytics } from '@/lib/server/analytics'
import { getFunnelDashboard } from '@/lib/server/funnel'
import { TrendBars } from './_components/TrendBars'
import { CompletionsList } from './_components/CompletionsList'

export const dynamic = 'force-dynamic'

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="ts-card" style={{ display: 'grid', gap: 6 }}>
      <span className="faint" style={{ fontSize: 13 }}>{label}</span>
      <strong style={{ fontSize: 28 }}>{value}</strong>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <h2 className="ts-h2">{title}</h2>
      {children}
    </section>
  )
}

const grid2 = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 } as const

function FunnelBar({ rows }: { rows: { step: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count))
  return (
    <div className="ts-card" style={{ display: 'grid', gap: 10 }}>
      {rows.map((r, i) => {
        const prev = i > 0 ? rows[i - 1].count : null
        const conv = prev && prev > 0 ? Math.round((r.count / prev) * 100) : null
        return (
          <div key={r.step} style={{ display: 'grid', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span>{r.step}</span>
              <span className="faint">{r.count}{conv != null && ` · ${conv}%`}</span>
            </div>
            <div style={{ height: 8, borderRadius: 999, background: 'var(--surface-3)', overflow: 'hidden' }}>
              <i style={{ display: 'block', height: '100%', width: `${(r.count / max) * 100}%`, background: 'var(--brand-grad)' }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default async function AnalyticsPage() {
  const supabase = createServiceClient()
  const [d, f] = await Promise.all([getAnalytics(supabase), getFunnelDashboard(supabase)])
  return (
    <div style={{ display: 'grid', gap: 28 }}>
      {/* Row 44: state the exclusion explicitly — an invisible filter is a
          filter nobody trusts. */}
      <div className="ts-card" style={{ padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span className="v-badge vb-broker">Internal traffic excluded</span>
        <span className="faint" style={{ fontSize: 12.5 }}>
          Every figure below counts genuine users only — admins, the team, seeded demo accounts
          and automated test signups are filtered out.
        </span>
      </div>

      <Section title="Core funnel (30 days, internal traffic excluded)">
        <FunnelBar rows={f.funnel} />
        {f.onboardingSteps.length > 0 && (
          <div className="ts-card">
            <span className="faint" style={{ fontSize: 13 }}>Onboarding step reach (abandonment)</span>
            <div className="mt-3" style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
              {f.onboardingSteps.map((s) => (
                <span key={s.step} style={{ fontSize: 14 }}>Step {s.step}: <strong>{s.count}</strong></span>
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section title="Lifecycle">
        <div style={grid2}>
          {f.lifecycle.map((l) => <Stat key={l.status} label={l.status} value={l.count} />)}
        </div>
      </Section>

      <Section title="Signups by source">
        <div className="ts-card" style={{ display: 'grid', gap: 6 }}>
          {f.sources.map((s) => (
            <div key={s.source} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <code>{s.source}</code><span className="faint">{s.count}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Feature adoption (activated users)">
        <div className="ts-card" style={{ display: 'grid', gap: 10 }}>
          {f.adoption.map((a) => (
            <div key={a.feature} style={{ display: 'grid', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span>{a.feature}</span>
                <span className="faint">{a.users} · {a.pct}%</span>
              </div>
              <div style={{ height: 6, borderRadius: 999, background: 'var(--surface-3)', overflow: 'hidden' }}>
                <i style={{ display: 'block', height: '100%', width: `${a.pct}%`, background: 'var(--brand-grad)' }} />
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Errors (30 days)">
        <div style={grid2}>
          <Stat label="404 hits" value={f.notFound30d} />
          <Stat label="Client errors" value={f.clientErrors30d} />
        </div>
        {f.topBrokenPaths.length > 0 && (
          <div className="ts-card">
            <span className="faint" style={{ fontSize: 13 }}>Top broken paths</span>
            <div className="mt-3" style={{ display: 'grid', gap: 6 }}>
              {f.topBrokenPaths.map((p) => (
                <div key={p.path} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <code style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.path}</code>
                  <span className="faint">{p.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section title="Growth">
        <div style={grid2}>
          <Stat label="Total users" value={d.growth.totalUsers} />
          <Stat label="New (7d)" value={d.growth.new7d} />
          <Stat label="New (30d)" value={d.growth.new30d} />
        </div>
        <TrendBars title="Signups / week" data={d.growth.signupsPerWeek} />
      </Section>

      <Section title="Engagement">
        <div style={grid2}>
          <Stat label="Active users (7d)" value={d.engagement.active7d} />
          <Stat label="Active users (30d)" value={d.engagement.active30d} />
          <Stat label="Trades logged" value={d.engagement.totalTrades} />
        </div>
        <TrendBars title="Trades / week" data={d.engagement.tradesPerWeek} />
        <TrendBars title="Posts / week" data={d.engagement.postsPerWeek} />
        <TrendBars title="Social actions / week" data={d.engagement.socialPerWeek} />
      </Section>

      <Section title="Content">
        <div style={grid2}>
          <Stat label="Course completions" value={d.content.totalCompletions} />
          <Stat label="Published lessons" value={d.content.publishedLessons} />
          <Stat label="Leaderboard participants" value={d.content.leaderboardParticipants} />
        </div>
        <TrendBars title="Completions / week" data={d.content.completionsPerWeek} />
        <div className="ts-card">
          <span className="faint" style={{ fontSize: 13 }}>Top courses</span>
          <div className="mt-3"><CompletionsList rows={d.content.topCourses} /></div>
        </div>
      </Section>

      <Section title="Ops">
        <div style={grid2}>
          <Stat label="Feedback total" value={d.ops.totalFeedback} />
          <Stat label="Open" value={d.ops.openFeedback} />
          <Stat label="Triaged" value={d.ops.triagedFeedback} />
          <Stat label="Resolved" value={d.ops.closedFeedback} />
        </div>
        <TrendBars title="Feedback / week" data={d.ops.feedbackPerWeek} />
      </Section>
    </div>
  )
}
