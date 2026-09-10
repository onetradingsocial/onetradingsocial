// app/src/app/admin/analytics/page.tsx
import { requireAdmin } from '@/lib/server/admin'
import { createServiceClient } from '@/lib/supabase/service'
import { getAnalytics } from '@/lib/server/analytics'
import { getFunnelDashboard } from '@/lib/server/funnel'
import { recentCronRuns } from '@/lib/server/cron-runs'
import { TrendBars } from './_components/TrendBars'
import { CompletionsList } from './_components/CompletionsList'
import { CronRuns } from './_components/CronRuns'
import { Meter, PageHead, Panel, Section, Stat, Stats } from '../_components/ui'

export const dynamic = 'force-dynamic'

// Brief plain-English explanation for each metric, shown as a hover/focus
// tooltip. Keyed by label so the map stays next to the copy it describes.
const HINTS: Record<string, string> = {
  // Funnel steps (last 30 days, internal traffic excluded). These hints used to
  // read "Users who…" throughout; only the first bar counts people. The rest
  // count event rows, and saying so is the difference between a caveat and a
  // wrong number.
  'App visitors (est.)': 'Best estimate of the distinct people who opened the app in the last 30 days. A person who browsed logged-out and then signed in on that device counts once. An upper bound, not a headcount: the anonymous id is per-device and rotates every 180 days, so one person on a phone and a laptop can still count twice.',
  'Signups completed': 'signup_completed events in the last 30 days — one per new account, email and Google alike.',
  'Onboarding completed': 'onboarding_completed events in the last 30 days. Event rows, not distinct users.',
  'First trade logged': 'first_trade_logged events — the activation moment. Event rows, not distinct users.',
  'Statement imports': 'trade_imported events (MT5 / CSV): one per import, so a user importing twice counts twice.',
  'Weekly review viewed': 'weekly_review_viewed events. A user opening their review every week counts every week.',
  'Checkout started': 'checkout_started events: a user who abandons and retries counts each attempt.',
  Subscribed: 'subscribed events in the last 30 days. For distinct paying users, read "Paid" in the lifecycle table below.',
  // Broker connect (last 30 days, internal traffic excluded). Keyed by the
  // labels lib/server/funnel.ts actually returns: the first two read
  // 'Broker card viewed' here and had no tooltip at all, because HINTS is
  // keyed by label and nothing notices when a key stops matching one.
  'Settings page reached': 'Times /settings rendered the MT5 auto-sync card — the step before any attempt. Server-side, so ad-blockers cannot hide it.',
  'Broker card on screen': 'Times the card actually entered the viewport. Client-fired, so ad-blockers and declined analytics consent make this a floor, not an exact count.',
  'Connect submitted': 'Times the connect form was actually submitted, counted before the Pro gate so a blocked attempt still registers.',
  'Broker connected': 'Attempts that ended in a live broker connection.',
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

function FunnelBars({ rows, title = 'Signup → activation' }: {
  rows: { step: string; count: number }[]
  title?: string
}) {
  const max = Math.max(1, ...rows.map((r) => r.count))
  return (
    <Panel title={title}>
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
  // Audit item 18, F2. The layout gate above this page is NOT the authorisation
  // check: a layout does not re-execute on every navigation within its segment,
  // so a crafted RSC request for a nested page can reach the page without it.
  // Every page below therefore repeats the check itself, which makes the
  // service-role query and its authorisation inseparable. The layout keeps its
  // own call — it renders the nav and must not leak that either.
  await requireAdmin()
  const supabase = createServiceClient()
  const [d, f, runs] = await Promise.all([
    getAnalytics(supabase),
    getFunnelDashboard(supabase),
    recentCronRuns(supabase, 'lifecycle-emails'),
  ])

  return (
    <>
      {/* The old sub read "Every figure counts genuine users only". Neither
          half survived the audit. Not "genuine users": seven of the eight
          funnel bars are `.length` on an event query — rows, not people (see
          lib/server/funnel.ts). And not "every figure": internal traffic is
          excluded everywhere, but by two different rules — event figures test
          the stamped `is_internal` column AND today's profiles table, while
          table-derived figures (lifecycle, sources, adoption) test the profile
          alone, because there is no stamp to go stale. Rebuilding the funnel on
          distinct users is its own piece of work; this sentence just stops the
          page claiming it has already happened. */}
      <PageHead
        title="Analytics"
        sub="Product health over the last 30 days. Internal traffic — admins, the team, seeded demo accounts and automated test signups — is excluded from every figure. Counting differs by section: the funnel and ops figures count events, so one person can appear more than once, while lifecycle, sources and feature adoption count distinct users from the tables."
        right={<span className="v-badge vb-broker">Internal excluded</span>}
      />

      <div className="adm-stack">
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

        <Section title="Broker connect" sub="The differentiator's own funnel. broker_accounts only records successes, so these events are the only way to tell an untried feature from a failing one.">
          <FunnelBars rows={f.brokerFunnel} title="Card → attempt → connection" />
          {f.brokerFailures.length > 0 && (
            <Panel title="Why attempts failed" flush>
              {f.brokerFailures.map((r) => (
                <div key={r.reason} className="adm-row">
                  <code className="adm-kv">{r.reason}</code>
                  <span className="sp faint" style={{ fontVariantNumeric: 'tabular-nums' }}>{r.count}</span>
                </div>
              ))}
            </Panel>
          )}
        </Section>

        <Section title="Lifecycle" sub="Delivery is counted separately from work done: a run can process ten users and deliver nothing, which is the failure this section exists to make visible.">
          <Stats>
            {f.lifecycle.map((l) => <Stat key={l.status} label={l.status} value={l.count} hint={HINTS[l.status]} />)}
          </Stats>
          <CronRuns rows={runs} />
        </Section>

        <Section title="Acquisition">
          <Panel title="Signups by source" flush>
            {f.sources.map((s) => (
              <div key={s.source} className="adm-row">
                <code className="adm-kv">{s.source}</code>
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
                <div key={p.path} className="adm-row">
                  <code className="adm-kv" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.path}</code>
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
