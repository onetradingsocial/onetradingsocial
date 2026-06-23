import { LessonEditForm } from '@/app/admin/_components/LessonEditForm'

export default async function NewLesson({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <h2 className="ts-h2">New lesson</h2>
      <LessonEditForm courseId={courseId} initial={{ slug: '', title: '', body: '', ord: 0, xpReward: 100 }} />
      <p className="faint">Save the lesson first, then add its quiz.</p>
    </div>
  )
}
