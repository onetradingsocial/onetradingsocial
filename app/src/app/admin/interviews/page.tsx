// Beta-user interview system (Sprint 4, row 28). Segments users the team may
// want to talk to — engaged, broker-connected, or churned-after-engaging — with
// a mailto invite. Read-only over service-role data.
import { createServiceClient } from '@/lib/supabase/service'
import { Empty, PageHead, Panel, Section } from '../_components/ui'

export const dynamic = 'force-dynamic'

const DAY = 864e5

type Seg = 'engaged' | 'connected' | 'churned'

function InviteLink({ email, username }: { email: string | null; username: string }) {
  if (!email) return <span className="faint">no email</span>
  const subject = encodeURIComponent('Quick chat about your TradingSocial experience?')
  const body = encodeURIComponent(`Hi @${username},\n\nWe're talking to a few early traders about what's working and what isn't. Would you be up for a 15-minute call?\n\nThanks,\nThe TradingSocial team`)
  return <a href={`mailto:${email}?subject=${subject}&body=${body}`} className="btn btn-ghost btn-sm">Invite</a>
}

export default async function InterviewsPage() {
  const svc = createServiceClient()
  const now = Date.now()

  const [{ data: profiles }, { data: trades }, { data: brokers }] = await Promise.all([
    svc.from('profiles').select('id, username, created_at').eq('is_internal', false),
    svc.from('trades').select('user_id, created_at').limit(50000),
    svc.from('broker_accounts').select('user_id, status'),
  ])

  const tradeCount = new Map<string, number>()
  const lastTrade = new Map<string, number>()
  for (const t of trades ?? []) {
    tradeCount.set(t.user_id, (tradeCount.get(t.user_id) ?? 0) + 1)
    const ts = Date.parse(t.created_at)
    if (!lastTrade.has(t.user_id) || ts > lastTrade.get(t.user_id)!) lastTrade.set(t.user_id, ts)
  }
  const connected = new Set((brokers ?? []).map((b) => b.user_id))

  const emailOf = async (uid: string) => (await svc.auth.admin.getUserById(uid)).data.user?.email ?? null

  const rows: { id: string; username: string; seg: Seg; trades: number; email: string | null }[] = []
  for (const p of profiles ?? []) {
    const n = tradeCount.get(p.id) ?? 0
    const last = lastTrade.get(p.id) ?? 0
    let seg: Seg | null = null
    if (n >= 5 && last > now - 7 * DAY) seg = 'engaged'
    else if (connected.has(p.id)) seg = 'connected'
    else if (n >= 3 && last > 0 && last < now - 14 * DAY) seg = 'churned'
    if (seg) rows.push({ id: p.id, username: p.username, seg, trades: n, email: null })
  }
  // Resolve emails only for the (bounded) candidate set.
  for (const r of rows) r.email = await emailOf(r.id)

  const groups: { seg: Seg; label: string; hint: string }[] = [
    { seg: 'engaged', label: 'Engaged', hint: '≥5 trades, active in last 7 days' },
    { seg: 'connected', label: 'Broker-connected', hint: 'Has an MT5 connection' },
    { seg: 'churned', label: 'Churned after engaging', hint: '≥3 trades, silent 14+ days' },
  ]

  return (
    <>
      <PageHead
        title="Interviews"
        sub="Users worth talking to, segmented by behaviour. Invite opens a pre-written mail in your client — nothing is sent from here."
      />

      <div className="ad-stack">
        {groups.map((g) => {
          const list = rows.filter((r) => r.seg === g.seg)
          return (
            <Section key={g.seg} title={g.label} sub={g.hint} right={<span className="v-badge">{list.length}</span>}>
              <Panel flush>
                {list.length === 0 ? <Empty>No users in this segment.</Empty> : list.map((r) => (
                  <div key={r.id} className="ad-row">
                    <span style={{ fontWeight: 600 }}>@{r.username}</span>
                    <span className="faint" style={{ fontSize: 12 }}>{r.trades} trades</span>
                    <span className="sp"><InviteLink email={r.email} username={r.username} /></span>
                  </div>
                ))}
              </Panel>
            </Section>
          )
        })}
      </div>
    </>
  )
}
