import Link from 'next/link'
import { requireAdmin } from '@/lib/server/admin'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()
  return (
    <main className="ts-page" style={{ maxWidth: 980 }}>
      <header className="lb-head"><div className="tx">
        <h1 className="ts-h1">Admin</h1>
        <p>Owner tools — feedback triage and learning content.</p>
      </div></header>
      <nav className="ts-nav-links mt-3" style={{ gap: 16 }}>
        <Link className="ts-nav-link" href="/admin">Home</Link>
        <Link className="ts-nav-link" href="/admin/feedback">Feedback</Link>
        <Link className="ts-nav-link" href="/admin/courses">Courses</Link>
      </nav>
      <div className="mt-6">{children}</div>
    </main>
  )
}
