import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCourses } from '@/lib/server/learning'

export default async function LearnPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const courses = await getCourses(supabase, user.id)

  return (
    <main className="ts-page" style={{ maxWidth: 820 }}>
      <header className="lb-head"><div className="tx">
        <h1 className="ts-h1">Learn</h1>
        <p>Work through courses, pass the quiz, earn XP. Your progress counts toward your level.</p>
      </div></header>
      <div className="learn-grid mt-6">
        {courses.map((c) => {
          const pct = c.lessonCount ? Math.round((c.completedCount / c.lessonCount) * 100) : 0
          return (
            <a key={c.id} href={`/app/learn/${c.slug}`} className="ts-card learn-card">
              {c.difficulty && <span className="eyebrow">{c.difficulty}</span>}
              <h2 className="ts-h2">{c.title}</h2>
              {c.summary && <p className="faint" style={{ fontSize: 14 }}>{c.summary}</p>}
              <div className="ach-bar mt-3"><i style={{ width: pct + '%' }} /></div>
              <p className="faint mt-3" style={{ fontSize: 12 }}>{c.completedCount}/{c.lessonCount} lessons</p>
            </a>
          )
        })}
      </div>
    </main>
  )
}
