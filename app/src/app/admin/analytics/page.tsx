// app/src/app/admin/analytics/page.tsx
import { createServiceClient } from '@/lib/supabase/service'
import { getAnalytics } from '@/lib/server/analytics'
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

export default async function AnalyticsPage() {
  const supabase = createServiceClient()
  const d = await getAnalytics(supabase)
  return (
    <div style={{ display: 'grid', gap: 28 }}>
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
