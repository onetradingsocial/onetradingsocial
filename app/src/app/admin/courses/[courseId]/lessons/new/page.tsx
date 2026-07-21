import Link from 'next/link'
import { LessonEditForm } from '@/app/admin/_components/LessonEditForm'
import { PageHead } from '@/app/admin/_components/ui'

export default async function NewLesson({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params
  return (
    <>
      <div style={{ marginBottom: 10 }}>
        <Link className="ad-kv" href={`/admin/courses/${courseId}`}>← Back to course</Link>
      </div>
      <PageHead title="New lesson" sub="Save the lesson first, then add its quiz. Lessons stay hidden from users until published." />
      <LessonEditForm courseId={courseId} initial={{ slug: '', title: '', body: '', ord: 0, xpReward: 100 }} />
    </>
  )
}
