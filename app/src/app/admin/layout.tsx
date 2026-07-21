import { requireAdmin } from '@/lib/server/admin'
import { createServiceClient } from '@/lib/supabase/service'
import { AdminNav, type NavGroup } from './_components/AdminNav'

/** Head-only count — no rows transferred. */
async function pending(table: string, col: string, value: string | boolean): Promise<number> {
  const svc = createServiceClient()
  const { count } = await svc.from(table).select('id', { count: 'exact', head: true }).eq(col, value)
  return count ?? 0
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()

  // Badges make the rail a work queue rather than a table of contents.
  const [openFeedback, openReports, openAlerts] = await Promise.all([
    pending('feedback', 'status', 'open'),
    pending('trade_reports', 'status', 'open'),
    pending('system_alerts', 'acked', false),
  ])

  const groups: NavGroup[] = [
    {
      title: 'Overview',
      items: [
        { href: '/admin', label: 'Dashboard', badge: openAlerts },
        { href: '/admin/analytics', label: 'Analytics' },
        { href: '/admin/cohorts', label: 'Cohorts' },
      ],
    },
    {
      title: 'Trust & safety',
      items: [
        { href: '/admin/verification', label: 'Verification', badge: openReports },
        { href: '/admin/audit', label: 'Audit log' },
      ],
    },
    {
      title: 'Users',
      items: [
        { href: '/admin/feedback', label: 'Feedback', badge: openFeedback },
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

  return (
    <main className="ad-page">
      <div className="ad-brand">
        <span className="dot" aria-hidden />
        <b>TradingSocial</b>
        <span className="env">Admin</span>
      </div>
      <div className="ad-shell">
        <AdminNav groups={groups} />
        <div>{children}</div>
      </div>
    </main>
  )
}
