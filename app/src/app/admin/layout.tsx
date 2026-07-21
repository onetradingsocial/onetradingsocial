import { requireAdmin } from '@/lib/server/admin'
import { createServiceClient } from '@/lib/supabase/service'
import { AdminNav, type NavCounts, type NavGroup } from './_components/AdminNav'

/** Head-only count — no rows transferred. */
async function pending(table: string, col: string, value: string | boolean): Promise<number> {
  const svc = createServiceClient()
  const { count } = await svc.from(table).select('id', { count: 'exact', head: true }).eq(col, value)
  return count ?? 0
}

/** Badges make the rail a work queue rather than a table of contents. */
async function navCounts(): Promise<NavCounts> {
  const [feedback, reports, alerts] = await Promise.all([
    pending('feedback', 'status', 'open'),
    pending('trade_reports', 'status', 'open'),
    pending('system_alerts', 'acked', false),
  ])
  return { feedback, reports, alerts }
}

const GROUPS: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { href: '/admin', label: 'Dashboard', countKey: 'alerts' },
      { href: '/admin/analytics', label: 'Analytics' },
      { href: '/admin/cohorts', label: 'Cohorts' },
    ],
  },
  {
    title: 'Trust & safety',
    items: [
      { href: '/admin/verification', label: 'Verification', countKey: 'reports' },
      { href: '/admin/audit', label: 'Audit log' },
    ],
  },
  {
    title: 'Users',
    items: [
      { href: '/admin/feedback', label: 'Feedback', countKey: 'feedback' },
      { href: '/admin/interviews', label: 'Interviews' },
      { href: '/admin/referrals', label: 'Referrals' },
    ],
  },
  {
    title: 'Product',
    items: [
      { href: '/admin/courses', label: 'Courses' },
      { href: '/admin/features', label: 'Feature flags' },
    ],
  },
]

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()
  // Not awaited: the promise is handed to the rail, which streams each badge in
  // separately so the shell and the page skeleton render without waiting.
  const counts = navCounts()

  return (
    <main className="ad-page">
      <div className="ad-brand">
        <span className="dot" aria-hidden />
        <b>TradingSocial</b>
        <span className="env">Admin</span>
      </div>
      <div className="ad-shell">
        <AdminNav groups={GROUPS} counts={counts} />
        <div>{children}</div>
      </div>
    </main>
  )
}
