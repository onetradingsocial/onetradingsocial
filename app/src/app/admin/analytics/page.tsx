// app/src/app/admin/analytics/page.tsx
import { createServiceClient } from '@/lib/supabase/service'
import { getAnalytics } from '@/lib/server/analytics'
import { getFunnelDashboard } from '@/lib/server/funnel'
import { TrendBars } from './_components/TrendBars'
import { CompletionsList } from './_components/CompletionsList'
import { Meter, PageHead, Panel, Section, Stat, Stats } from '../_components/ui'

export const dynamic = 'force-dynamic'

// Brief plain-English explanation for each metric, shown as a hover/focus
// tooltip. Keyed by label so the map stays next to the copy it describes.
const HINTS: Record<string, string> = {
  // Funnel steps (last 30 days, internal traffic excluded)
  'App visitors': 'Distinct people who opened the app in the last 30 days (signed-in users + anonymous visitors).',
  'Signups completed': 'Accounts that finished the signup form in the last 30 days.',
  'Onboarding completed': 'Users who finished the first-run onboarding flow.',
  'First trade logged': 'Users who logged their first trade — the activation moment.',
  'Statement imports': 'Users who imported a broker statement (MT5 / CSV).',
  'Weekly review viewed': 'Users who opened their weekly review at least once.',
  'Checkout started': 'Users who began Stripe checkout for a paid plan.',
  Subscribed: 'Users who completed a paid subscription.',
  // Lifecycle buckets (DB truth, each user in exactly one bucket)
  Registered: 'Every genuine account. The base all other lifecycle buckets are carved from.',
  Onboarding: 'Signed up but never finished onboarding. Stuck at the very first step — 0 trades.',
  'Activated (≥1 trade)': 'Finished onboarding and logged at least one trade. The core activation bar.',
  'Engaged (7d)': 'Activated users whose most recent trade is within the last 7 days.',
  'Retained (7d, older accts)': 'Engaged users whose account is older than 7 days — real retention, not fresh signups.',
  'At risk (8–30d idle)': 'Activated but no trade in 8–30 days. Winnable back.',
  'Churned (30d+ idle)': 'Activated but no trade in over 30 days.',
  Paid: 'Genuine users with an active or trialing Stripe subscription.',
  // Growth / engagement / content / ops
  'Total users': 'All genuine accounts (internal, seed and test signups excluded).',
  'New (7d)': 'Genuine signups in the last 7 days.',
  'New (30d)': 'Genuine signups in the last 30 days.',
  'Active users (7d)': 'Distinct users with any activity (trade, post, comment, like, completion) in 7 days.',
  'Active users (30d)': 'Distinct users with any activity in the last 30 days.',
  'Trades logged': 'All trades logged by genuine users, all time.',
  'Course completions': 'Total lessons completed by genuine users.',
  'Published lessons': 'Lessons currently live in the learn section.',
  'Leaderboard participants': 'Users with at least one public closed trade — the leaderboard pool.',
  'Feedback total': 'All feedback submissions from genuine users.',
  Open: 'Feedback not yet triaged.',
  Triaged: 'Feedback reviewed and categorised, awaiting resolution.',
  Resolved: 'Feedback closed out.',
  '404 hits': 'not_found events in the last 30 days.',
  'Client errors': 'Client-side JS errors reported in the last 30 days.',
}

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
            hint={HINTS[r.step]}
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
            {f.lifecycle.map((l) => <Stat key={l.status} label={l.status} value={l.count} hint={HINTS[l.status]} />)}
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
            <Stat label="404 hits" value={f.notFound30d} tone={f.notFound30d > 0 ? 'warn' : undefined} hint={HINTS['404 hits']} />
            <Stat label="Client errors" value={f.clientErrors30d} tone={f.clientErrors30d > 0 ? 'warn' : undefined} hint={HINTS['Client errors']} />
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
            <Stat label="Total users" value={d.growth.totalUsers} tone="accent" hint={HINTS['Total users']} />
            <Stat label="New (7d)" value={d.growth.new7d} hint={HINTS['New (7d)']} />
            <Stat label="New (30d)" value={d.growth.new30d} hint={HINTS['New (30d)']} />
          </Stats>
          <TrendBars title="Signups / week" data={d.growth.signupsPerWeek} />
        </Section>

        <Section title="Engagement">
          <Stats>
            <Stat label="Active users (7d)" value={d.engagement.active7d} hint={HINTS['Active users (7d)']} />
            <Stat label="Active users (30d)" value={d.engagement.active30d} hint={HINTS['Active users (30d)']} />
            <Stat label="Trades logged" value={d.engagement.totalTrades} hint={HINTS['Trades logged']} />
          </Stats>
          <TrendBars title="Trades / week" data={d.engagement.tradesPerWeek} />
          <TrendBars title="Posts / week" data={d.engagement.postsPerWeek} />
          <TrendBars title="Social actions / week" data={d.engagement.socialPerWeek} />
        </Section>

        <Section title="Content">
          <Stats>
            <Stat label="Course completions" value={d.content.totalCompletions} hint={HINTS['Course completions']} />
            <Stat label="Published lessons" value={d.content.publishedLessons} hint={HINTS['Published lessons']} />
            <Stat label="Leaderboard participants" value={d.content.leaderboardParticipants} hint={HINTS['Leaderboard participants']} />
          </Stats>
          <TrendBars title="Completions / week" data={d.content.completionsPerWeek} />
          <Panel title="Top courses">
            <CompletionsList rows={d.content.topCourses} />
          </Panel>
        </Section>

        <Section title="Ops">
          <Stats>
            <Stat label="Feedback total" value={d.ops.totalFeedback} hint={HINTS['Feedback total']} />
            <Stat label="Open" value={d.ops.openFeedback} tone={d.ops.openFeedback > 0 ? 'warn' : undefined} hint={HINTS.Open} />
            <Stat label="Triaged" value={d.ops.triagedFeedback} hint={HINTS.Triaged} />
            <Stat label="Resolved" value={d.ops.closedFeedback} hint={HINTS.Resolved} />
          </Stats>
          <TrendBars title="Feedback / week" data={d.ops.feedbackPerWeek} />
        </Section>
      </div>
    </>
  )
}
