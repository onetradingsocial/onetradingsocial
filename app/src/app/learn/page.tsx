import { redirect } from 'next/navigation'
import { createClient, getSessionUser } from '@/lib/supabase/server'
import Link from 'next/link'
import { getCourses } from '@/lib/server/learning'
import { getTier } from '@/lib/server/entitlements'
import { TIER_RANK, type Tier } from '@/lib/entitlements'

export default async function LearnPage() {
  const supabase = await createClient()
  const user = await getSessionUser(supabase)
  if (!user) redirect('/login')
  const [courses, tier] = await Promise.all([
    getCourses(supabase, user.id),
    getTier(supabase, user.id),
  ])

  return (
    <main className="ts-page" style={{ maxWidth: 820 }}>
      <header className="lb-head"><div className="tx">
        <h1 className="ts-h1">Learn</h1>
        <p>Work through courses, pass the quiz, earn XP. Your progress counts toward your level.</p>
      </div></header>
      <div className="learn-grid mt-6">
        {courses.map((c) => {
          const pct = c.lessonCount ? Math.round((c.completedCount / c.lessonCount) * 100) : 0
          const locked = TIER_RANK[tier] < TIER_RANK[(c.minTier as Tier) ?? 'free']
          if (locked) {
            const badge = c.minTier === 'pro' ? '🔒 Pro' : '🔒 Trader'
            return (
              <Link key={c.id} href="/settings/billing" className="ts-card learn-card" style={{ opacity: 0.7 }}>
                {c.difficulty && <span className="eyebrow">{c.difficulty}</span>}
                <h2 className="ts-h2">{c.title}</h2>
                {c.summary && <p className="faint" style={{ fontSize: 14 }}>{c.summary}</p>}
                <span className="eyebrow mt-3" style={{ display: 'inline-block' }}>{badge}</span>
              </Link>
            )
          }
          return (
            <Link key={c.id} href={`/learn/${c.slug}`} className="ts-card learn-card">
              {c.difficulty && <span className="eyebrow">{c.difficulty}</span>}
              <h2 className="ts-h2">{c.title}</h2>
              {c.summary && <p className="faint" style={{ fontSize: 14 }}>{c.summary}</p>}
              <div className="ach-bar mt-3"><i style={{ width: pct + '%' }} /></div>
              <p className="faint mt-3" style={{ fontSize: 12 }}>{c.completedCount}/{c.lessonCount} lessons</p>
            </Link>
          )
        })}
      </div>
    </main>
  )
}
