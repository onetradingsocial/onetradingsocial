import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildDashboard, type AnalyticsDashboard } from '@/lib/analytics'

export async function getAnalytics(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<AnalyticsDashboard> {
  // Exclude internal + test traffic (row 44). Without this the dashboard is
  // dominated by Playwright e2e signups and seeded demo accounts.
  const { data: realProfiles } = await supabase
    .from('profiles').select('id, created_at').eq('is_internal', false)
  const realIds = (realProfiles ?? []).map((p) => p.id)
  // PostgREST needs a non-empty list; a sentinel UUID matches nothing.
  const idFilter = realIds.length ? realIds : ['00000000-0000-0000-0000-000000000000']

  const [trades, closedPublic, posts, comments, likes, completions, lessons, feedback] =
    await Promise.all([
      supabase.from('trades').select('user_id, created_at').in('user_id', idFilter),
      supabase.from('trades').select('user_id, created_at').eq('is_public', true).eq('status', 'closed').in('user_id', idFilter),
      supabase.from('posts').select('author_id, created_at').in('author_id', idFilter),
      supabase.from('comments').select('author_id, created_at').in('author_id', idFilter),
      supabase.from('likes').select('user_id, created_at').in('user_id', idFilter),
      supabase.from('lesson_completions').select('user_id, completed_at, lessons(courses(title))').in('user_id', idFilter),
      supabase.from('lessons').select('id', { count: 'exact', head: true }).eq('published', true),
      supabase.from('feedback').select('created_at, status').in('user_id', idFilter),
    ])

  // Row shapes for the selects above. They are written out rather than inferred
  // because these queries go through an untyped SupabaseClient: without them
  // every row is `any`, and a renamed column would surface as `undefined` in a
  // dashboard number instead of as a type error here.
  type Created = { created_at: string }
  type ByUser = Created & { user_id: string }
  type ByAuthor = Created & { author_id: string }
  type CourseRef = { title: string } | { title: string }[] | null
  type CompletionRow = {
    completed_at: string
    user_id: string
    lessons: { courses: CourseRef } | { courses: CourseRef }[] | null
  }

  const data = <T,>(r: { data: T[] | null }): T[] => r.data ?? []
  const completionRows = data<CompletionRow>(completions as { data: CompletionRow[] | null })
  const profiles = { data: realProfiles }

  return buildDashboard(
    {
      profiles: data<Created>(profiles).map((p) => ({ createdAt: p.created_at })),
      trades: data<ByUser>(trades).map((t) => ({ createdAt: t.created_at, userId: t.user_id })),
      closedPublicTrades: data<ByUser>(closedPublic).map((t) => ({ createdAt: t.created_at, userId: t.user_id })),
      posts: data<ByAuthor>(posts).map((p) => ({ createdAt: p.created_at, userId: p.author_id })),
      comments: data<ByAuthor>(comments).map((c) => ({ createdAt: c.created_at, userId: c.author_id })),
      likes: data<ByUser>(likes).map((l) => ({ createdAt: l.created_at, userId: l.user_id })),
      completions: completionRows.map((c) => ({ createdAt: c.completed_at, userId: c.user_id })),
      completionsByCourse: completionRows.map((c) => {
        // PostgREST FK embeds can return arrays even for to-one relationships; normalize both shapes.
        const lesson = Array.isArray(c.lessons) ? c.lessons[0] : c.lessons
        const course = Array.isArray(lesson?.courses) ? lesson.courses[0] : lesson?.courses
        return { courseTitle: course?.title ?? 'Unknown' }
      }),
      publishedLessons: lessons.count ?? 0,
      feedback: data<Created & { status: string }>(feedback).map((f) => ({ createdAt: f.created_at, status: f.status })),
    },
    now,
  )
}
