import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/service'
import { parseAdminEmails } from '@/lib/admin'
import { userTierSummary } from '@/lib/admin-users'
import { Empty, PageHead, Panel, When } from '../_components/ui'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

type Row = {
  id: string
  username: string
  display_name: string | null
  email: string | null
  created_at: string
  comp_tier: string | null
  sub_tier: string | null
  sub_status: string | null
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>
}) {
  const { q = '', page = '1' } = await searchParams
  const term = q.trim()
  const pageNum = Math.max(1, Number.parseInt(page, 10) || 1)
  const offset = (pageNum - 1) * PAGE_SIZE

  const svc = createServiceClient()
  // Fetch one extra row to detect whether a next page exists.
  const { data, error } = await svc.rpc('admin_search_users', {
    term,
    lim: PAGE_SIZE + 1,
    off: offset,
  })
  const rows = ((data ?? []) as Row[]).slice(0, PAGE_SIZE)
  const hasNext = (data ?? []).length > PAGE_SIZE
  const admins = parseAdminEmails(process.env.ADMIN_EMAILS)

  const qs = (p: number) => {
    const s = new URLSearchParams()
    if (term) s.set('q', term)
    if (p > 1) s.set('page', String(p))
    const str = s.toString()
    return str ? `/admin/users?${str}` : '/admin/users'
  }

  return (
    <>
      <PageHead
        title="Users"
        sub="Search the directory and grant comped Trader/Pro access. Comp grants unlock features only — never admin access."
      />

      <form method="get" style={{ margin: '0 0 16px' }}>
        <input
          type="search"
          name="q"
          defaultValue={term}
          placeholder="Search email, username, or display name…"
          className="ts-input"
          style={{ width: '100%', maxWidth: 420 }}
          aria-label="Search users"
        />
      </form>

      <Panel title={term ? `Results for “${term}”` : 'All users'} flush scroll>
        {error ? (
          <Empty>Search failed. Confirm migration 0039 is applied.</Empty>
        ) : rows.length === 0 ? (
          <Empty>No users match.</Empty>
        ) : (
          <table className="ts-table">
            <thead><tr><th>User</th><th>Email</th><th>Tier</th><th>Source</th><th>Joined</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const { tier, source } = userTierSummary({
                  email: r.email,
                  compTier: r.comp_tier,
                  subTier: r.sub_tier,
                  subStatus: r.sub_status,
                  adminEmails: admins,
                })
                return (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/admin/users/${r.id}`} className="ad-kv">{r.username}</Link>
                      {r.display_name && <span className="faint" style={{ fontSize: 12, marginLeft: 6 }}>{r.display_name}</span>}
                    </td>
                    <td style={{ fontSize: 13 }}>{r.email ?? '—'}</td>
                    <td><span className="v-badge">{tier}</span></td>
                    <td className="faint" style={{ fontSize: 12 }}>{source}</td>
                    <td><When iso={r.created_at} short /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Panel>

      <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center' }}>
        {pageNum > 1
          ? <Link className="ad-kv" href={qs(pageNum - 1)}>← Prev</Link>
          : <span className="faint" style={{ fontSize: 13 }}>← Prev</span>}
        <span className="faint" style={{ fontSize: 13 }}>Page {pageNum}</span>
        {hasNext
          ? <Link className="ad-kv" href={qs(pageNum + 1)}>Next →</Link>
          : <span className="faint" style={{ fontSize: 13 }}>Next →</span>}
      </div>
    </>
  )
}
