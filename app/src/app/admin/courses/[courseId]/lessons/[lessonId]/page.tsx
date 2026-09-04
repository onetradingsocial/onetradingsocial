import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/server/admin'
import { createServiceClient } from '@/lib/supabase/service'
import { setLessonPublished, type QuestionInput } from '@/app/actions/admin'
import { LessonEditForm } from '@/app/admin/_components/LessonEditForm'
import { QuizEditor } from '@/app/admin/_components/QuizEditor'
import { PublishToggle } from '@/app/admin/_components/PublishToggle'
import { PageHead } from '@/app/admin/_components/ui'

export default async function LessonEdit({ params }: { params: Promise<{ courseId: string; lessonId: string }> }) {
  // Audit item 18, F2. The layout gate above this page is NOT the authorisation
  // check: a layout does not re-execute on every navigation within its segment,
  // so a crafted RSC request for a nested page can reach the page without it.
  // Every page below therefore repeats the check itself, which makes the
  // service-role query and its authorisation inseparable. The layout keeps its
  // own call — it renders the nav and must not leak that either.
  await requireAdmin()
  const { courseId, lessonId } = await params
  const svc = createServiceClient()
  const { data: lesson } = await svc.from('lessons')
    .select('id, slug, title, body, ord, xp_reward, published').eq('id', lessonId).maybeSingle()
  if (!lesson) notFound()
  const { data: questions } = await svc.from('quiz_questions')
    .select('id, prompt, ord, quiz_options(label, is_correct, ord)').eq('lesson_id', lessonId).order('ord')
  const initialQuiz: QuestionInput[] = (questions ?? []).map((q) => ({
    prompt: q.prompt,
    options: ((q.quiz_options as { label: string; is_correct: boolean; ord: number }[]) ?? [])
      .sort((a, b) => a.ord - b.ord).map((o) => ({ label: o.label, isCorrect: o.is_correct })),
  }))

  return (
    <>
      <div style={{ marginBottom: 10 }}>
        <Link className="adm-kv" href={`/admin/courses/${courseId}`}>← Back to course</Link>
      </div>
      <PageHead
        title={lesson.title}
        sub={`Lesson ${lesson.ord} · ${lesson.xp_reward} XP · /${lesson.slug}`}
        right={<PublishToggle published={lesson.published} action={setLessonPublished.bind(null, lesson.id)} />}
      />
      <div style={{ display: 'grid', gap: 16 }}>
        <LessonEditForm courseId={courseId} lessonId={lesson.id} initial={{
          slug: lesson.slug, title: lesson.title, body: lesson.body, ord: lesson.ord, xpReward: lesson.xp_reward,
        }} />
        <QuizEditor lessonId={lesson.id} initial={initialQuiz} />
      </div>
    </>
  )
}
