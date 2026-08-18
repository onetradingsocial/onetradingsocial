import Link from 'next/link'
import { requireAdmin } from '@/lib/server/admin'
import { logAdminRead } from '@/lib/server/admin-audit'
import { createServiceClient } from '@/lib/supabase/service'
import { parseAdminEmails } from '@/lib/admin'
import { maskEmail } from '@/lib/admin-mask'
import {
  userTierSummary, normalizeAccountFilter, normalizeSubFilter, normalizeCompFilter,
} from '@/lib/admin-users'
import { RevealEmail } from '../_components/RevealEmail'
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
  is_internal: boolean
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; account?: string; sub?: string; comp?: string }>
}) {
  // Audit item 18, F2 — see the note in admin/page.tsx.
  const admin = await requireAdmin()
  const sp = await searchParams
  const term = (sp.q ?? '').trim()
  const account = normalizeAccountFilter(sp.account)
  const sub = normalizeSubFilter(sp.sub)
  const comp = normalizeCompFilter(sp.comp)
  const pageNum = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1)
  const offset = (pageNum - 1) * PAGE_SIZE

  const svc = createServiceClient()
  const { data, error } = await svc.rpc('admin_search_users', {
    term, p_account: account, p_sub: sub, p_comp: comp, lim: PAGE_SIZE + 1, off: offset,
  })
  const rows = ((data ?? []) as Row[]).slice(0, PAGE_SIZE)
  const hasNext = (data ?? []).length > PAGE_SIZE
  const admins = parseAdminEmails(process.env.ADMIN_EMAILS)

  // Audit item 18, F4. A *search* is a targeted lookup of a person and is
  // logged with the term; paging through the unfiltered directory is not,
  // because a row for every load of the landing page is noise that buries the
  // rows that mean something. The term itself is the interesting part — it is
  // usually the email or name of whoever was being looked for — so it is
  // recorded, along with how many rows came back.
  //
  // The term is stored even though it is frequently somebody's email address,
  // which does put an identifier into a table this workstream otherwise keeps
  // identifiers out of. That is a deliberate trade, not an oversight: without
  // the term the row says only "an admin searched" and answers none of the
  // questions the log exists for. It is the admin's own act, it is retained
  // under the same security/audit basis as the rest of the table, and it ages
  // out on the same 24-month window (0052). Capped so a pasted document cannot
  // become a log entry.
  if (term) {
    await logAdminRead(admin, 'users.search', undefined, {
      term: term.slice(0, 100), account, sub, comp, page: pageNum, results: rows.length,
    })
  }

  const qs = (p: number) => {
    const s = new URLSearchParams()
    if (term) s.set('q', term)
    if (account !== 'real') s.set('account', account)
    if (sub !== 'any') s.set('sub', sub)
    if (comp !== 'any') s.set('comp', comp)
    if (p > 1) s.set('page', String(p))
    const str = s.toString()
    return str ? `/admin/users?${str}` : '/admin/users'
  }
  const filtered = Boolean(term) || account !== 'real' || sub !== 'any' || comp !== 'any'

  return (
    <>
      <PageHead
        title="Users"
        sub="Search the directory and grant comped Trader/Pro access. Comp grants unlock features only — never admin access. Email addresses are masked; search still matches the full address, and revealing one is recorded in the audit log."
      />

      <form method="get" className="ad-filterbar">
        <input
          type="search" name="q" defaultValue={term}
          placeholder="Search email, username, or name…" className="ts-input"
          style={{ flex: '1 1 240px', minWidth: 0 }} aria-label="Search users"
        />
        <select name="account" defaultValue={account} className="ts-select" aria-label="Account type">
          <option value="real">Real users</option>
          <option value="test">Test / internal</option>
          <option value="all">All accounts</option>
        </select>
        <select name="sub" defaultValue={sub} className="ts-select" aria-label="Subscription">
          <option value="any">Any sub</option>
          <option value="free">No sub</option>
          <option value="trader">Trader sub</option>
          <option value="pro">Pro sub</option>
        </select>
        <select name="comp" defaultValue={comp} className="ts-select" aria-label="Comp grant">
          <option value="any">Any comp</option>
          <option value="comped">Comped</option>
          <option value="not">Not comped</option>
        </select>
        <button type="submit" className="btn btn-ghost btn-sm">Apply</button>
        {filtered && <Link href="/admin/users" className="ad-kv">Reset</Link>}
      </form>

      <Panel title={term ? `Results for “${term}”` : 'Users'} flush scroll>
        {error ? (
          <Empty>Search failed. Confirm migration 0040 is applied.</Empty>
        ) : rows.length === 0 ? (
          <Empty>No users match these filters.</Empty>
        ) : (
          <table className="ts-table">
            <thead><tr><th>User</th><th>Email</th><th>Tier</th><th>Source</th><th>Joined</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const { tier, source } = userTierSummary({
                  email: r.email, compTier: r.comp_tier,
                  subTier: r.sub_tier, subStatus: r.sub_status, adminEmails: admins,
                })
                return (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/admin/users/${r.id}`} className="ad-kv">{r.username}</Link>
                      {r.display_name && <span className="faint" style={{ fontSize: 12, marginLeft: 6 }}>{r.display_name}</span>}
                      {r.is_internal && <span className="ad-chip--test">test</span>}
                    </td>
                    <td>
                      <RevealEmail userId={r.id} masked={maskEmail(r.email)} context="directory" />
                    </td>
                    <td><span className={`ad-tier ad-tier--${tier}`}>{tier}</span></td>
                    <td><span className={`ad-src ad-src--${source.toLowerCase()}`}>{source}</span></td>
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
