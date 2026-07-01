import { redirect } from 'next/navigation'
import { createClient, getSessionUser } from '@/lib/supabase/server'
import Link from 'next/link'
import { getCourses, getUserLearning } from '@/lib/server/learning'
import { getTier } from '@/lib/server/entitlements'
import { TIER_RANK, type Tier } from '@/lib/entitlements'

export default async function LearnPage() {
  const supabase = await createClient()
  const user = await getSessionUser(supabase)
  if (!user) redirect('/login')
  const [courses, tier, learning] = await Promise.all([
    getCourses(supabase, user.id),
    getTier(supabase, user.id),
    getUserLearning(supabase, user.id),
  ])

  const totalLessons = courses.reduce((s, c) => s + c.lessonCount, 0)
  const totalDone = courses.reduce((s, c) => s + c.completedCount, 0)
  const coursesDone = courses.filter((c) => c.lessonCount > 0 && c.completedCount >= c.lessonCount).length
  const overallPct = totalLessons ? Math.round((totalDone / totalLessons) * 100) : 0

  return (
    <main className="ts-page" style={{ maxWidth: 900 }}>
      <header className="lb-head"><div className="tx">
        <span className="eyebrow">Learning Hub</span>
        <h1 className="ts-h1">Learn</h1>
        <p>Work through courses, pass the quiz, earn XP. Your progress counts toward your level.</p>
      </div></header>

      <section className="ts-card learn-hero mt-6" aria-label="Your learning progress">
        <div
          className="learn-hero-ring"
          style={{ ['--p' as string]: overallPct }}
          role="img"
          aria-label={`${overallPct}% of all lessons complete`}
        >
          <span className="learn-hero-ring-num">{overallPct}<i>%</i></span>
        </div>
        <div className="learn-hero-stats">
          <p className="eyebrow">Your progress</p>
          <div className="learn-stats-row">
            <div className="learn-stat">
              <b>{totalDone}<span>/{totalLessons}</span></b>
              <span className="k">Lessons</span>
            </div>
            <div className="learn-stat">
              <b>{coursesDone}<span>/{courses.length}</span></b>
              <span className="k">Courses</span>
            </div>
            <div className="learn-stat">
              <b className="grad-text">{learning.learningXp.toLocaleString()}</b>
              <span className="k">XP earned</span>
            </div>
          </div>
        </div>
      </section>

      <div className="learn-grid mt-6">
        {courses.map((c) => {
          const pct = c.lessonCount ? Math.round((c.completedCount / c.lessonCount) * 100) : 0
          const locked = TIER_RANK[tier] < TIER_RANK[(c.minTier as Tier) ?? 'free']

          if (locked) {
            const badge = c.minTier === 'pro' ? 'Pro' : 'Trader'
            return (
              <Link key={c.id} href="/settings/billing" className="ts-card learn-card is-locked">
                <div className="learn-card-top">
                  {c.difficulty && <span className="eyebrow">{c.difficulty}</span>}
                  <span className="ts-chip2 learn-lock-chip" style={{ marginLeft: 'auto' }}>🔒 {badge}</span>
                </div>
                <h2 className="ts-h2">{c.title}</h2>
                {c.summary && <p className="learn-card-sum faint">{c.summary}</p>}
                <span className="learn-card-cta">Upgrade to unlock →</span>
              </Link>
            )
          }

          const done = c.lessonCount > 0 && c.completedCount >= c.lessonCount
          const started = c.completedCount > 0
          const status = done ? 'Complete' : started ? 'In progress' : 'Not started'
          return (
            <Link
              key={c.id}
              href={`/learn/${c.slug}`}
              className={'ts-card learn-card' + (done ? ' is-done' : '')}
            >
              <div className="learn-card-top">
                {c.difficulty && <span className="eyebrow">{c.difficulty}</span>}
                <span
                  className={'ts-chip2 learn-status' + (done ? ' is-done' : started ? ' is-active' : '')}
                  style={{ marginLeft: 'auto' }}
                >
                  {done ? '✓ ' : ''}{status}
                </span>
              </div>
              <h2 className="ts-h2">{c.title}</h2>
              {c.summary && <p className="learn-card-sum faint">{c.summary}</p>}
              <div className="learn-card-foot">
                <div className="ach-bar"><i style={{ width: pct + '%' }} /></div>
                <div className="learn-card-meta">
                  <span className="faint">{c.completedCount}/{c.lessonCount} lessons</span>
                  <span className="learn-pct">{pct}%</span>
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </main>
  )
}
