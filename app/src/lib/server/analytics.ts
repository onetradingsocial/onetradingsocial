import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildDashboard, type AnalyticsDashboard } from '@/lib/analytics'

export async function getAnalytics(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<AnalyticsDashboard> {
  const [profiles, trades, closedPublic, posts, comments, likes, completions, lessons, feedback] =
    await Promise.all([
      supabase.from('profiles').select('created_at'),
      supabase.from('trades').select('user_id, created_at'),
      supabase.from('trades').select('user_id, created_at').eq('is_public', true).eq('status', 'closed'),
      supabase.from('posts').select('author_id, created_at'),
      supabase.from('comments').select('author_id, created_at'),
      supabase.from('likes').select('user_id, created_at'),
      supabase.from('lesson_completions').select('user_id, completed_at, lessons(courses(title))'),
      supabase.from('lessons').select('id', { count: 'exact', head: true }).eq('published', true),
      supabase.from('feedback').select('created_at, status'),
    ])

  const data = <T,>(r: { data: T[] | null }): T[] => r.data ?? []
  const completionRows = data<any>(completions)

  return buildDashboard(
    {
      profiles: data<any>(profiles).map((p) => ({ createdAt: p.created_at })),
      trades: data<any>(trades).map((t) => ({ createdAt: t.created_at, userId: t.user_id })),
      closedPublicTrades: data<any>(closedPublic).map((t) => ({ createdAt: t.created_at, userId: t.user_id })),
      posts: data<any>(posts).map((p) => ({ createdAt: p.created_at, userId: p.author_id })),
      comments: data<any>(comments).map((c) => ({ createdAt: c.created_at, userId: c.author_id })),
      likes: data<any>(likes).map((l) => ({ createdAt: l.created_at, userId: l.user_id })),
      completions: completionRows.map((c) => ({ createdAt: c.completed_at, userId: c.user_id })),
      completionsByCourse: completionRows.map((c) => {
        // PostgREST FK embeds can return arrays even for to-one relationships; normalize both shapes.
        const lesson = Array.isArray(c.lessons) ? c.lessons[0] : c.lessons
        const course = Array.isArray(lesson?.courses) ? lesson.courses[0] : lesson?.courses
        return { courseTitle: course?.title ?? 'Unknown' }
      }),
      publishedLessons: lessons.count ?? 0,
      feedback: data<any>(feedback).map((f) => ({ createdAt: f.created_at, status: f.status })),
    },
    now,
  )
}
