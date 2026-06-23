import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/service'
import { NewCourseForm } from '../_components/NewCourseForm'

export default async function AdminCourses() {
  const svc = createServiceClient()
  const { data: courses } = await svc.from('courses').select('id, title, slug, published, ord').order('ord')
  return (
    <div>
      <div className="ts-card" style={{ padding: 0 }}>
        {(courses ?? []).map((c) => (
          <Link key={c.id} href={`/admin/courses/${c.id}`}
            style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 14, borderTop: '1px solid var(--border)' }}>
            <strong>{c.title}</strong>
            <span className="faint" style={{ fontSize: 12 }}>/{c.slug}</span>
            <span className="eyebrow" style={{ marginLeft: 'auto' }}>{c.published ? 'Published' : 'Draft'}</span>
          </Link>
        ))}
      </div>
      <NewCourseForm />
    </div>
  )
}
