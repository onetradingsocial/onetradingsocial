import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { setLessonPublished, type QuestionInput } from '@/app/actions/admin'
import { LessonEditForm } from '@/app/admin/_components/LessonEditForm'
import { QuizEditor } from '@/app/admin/_components/QuizEditor'
import { PublishToggle } from '@/app/admin/_components/PublishToggle'

export default async function LessonEdit({ params }: { params: Promise<{ courseId: string; lessonId: string }> }) {
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
    <div style={{ display: 'grid', gap: 20 }}>
      <Link className="ts-nav-link" href={`/admin/courses/${courseId}`}>← Back to course</Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 className="ts-h2">Edit lesson</h2>
        <span style={{ marginLeft: 'auto' }}>
          <PublishToggle published={lesson.published} action={setLessonPublished.bind(null, lesson.id)} />
        </span>
      </div>
      <LessonEditForm courseId={courseId} lessonId={lesson.id} initial={{
        slug: lesson.slug, title: lesson.title, body: lesson.body, ord: lesson.ord, xpReward: lesson.xp_reward,
      }} />
      <QuizEditor lessonId={lesson.id} initial={initialQuiz} />
    </div>
  )
}
