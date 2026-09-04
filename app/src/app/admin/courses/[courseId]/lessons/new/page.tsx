import Link from 'next/link'
import { requireAdmin } from '@/lib/server/admin'
import { LessonEditForm } from '@/app/admin/_components/LessonEditForm'
import { PageHead } from '@/app/admin/_components/ui'

export default async function NewLesson({ params }: { params: Promise<{ courseId: string }> }) {
  // Audit item 18, F2. The layout gate above this page is NOT the authorisation
  // check: a layout does not re-execute on every navigation within its segment,
  // so a crafted RSC request for a nested page can reach the page without it.
  // Every page below therefore repeats the check itself, which makes the
  // service-role query and its authorisation inseparable. The layout keeps its
  // own call — it renders the nav and must not leak that either.
  await requireAdmin()
  const { courseId } = await params
  return (
    <>
      <div style={{ marginBottom: 10 }}>
        <Link className="adm-kv" href={`/admin/courses/${courseId}`}>← Back to course</Link>
      </div>
      <PageHead title="New lesson" sub="Save the lesson first, then add its quiz. Lessons stay hidden from users until published." />
      <LessonEditForm courseId={courseId} initial={{ slug: '', title: '', body: '', ord: 0, xpReward: 100 }} />
    </>
  )
}
