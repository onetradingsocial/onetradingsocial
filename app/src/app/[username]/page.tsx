import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { RESERVED_USERNAMES } from '@/lib/username'
import { computeMetrics, type TradeForMetrics } from '@/lib/trade'
import { StatsBar } from '@/app/journal/_components/StatsBar'

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>
}) {
  const { username } = await params
  if ((RESERVED_USERNAMES as readonly string[]).includes(username.toLowerCase())) notFound()

  const supabase = await createClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('username, display_name, bio, avatar_url, experience_level, main_markets, trading_styles, xp, level, created_at')
    .eq('username', username)
    .maybeSingle()

  // RLS hides private profiles from non-owners -> no row -> 404 (no existence leak).
  if (!profile) notFound()

  const name = profile.display_name ?? profile.username
  const initial = name.charAt(0).toUpperCase()
  const styles: string[] = profile.trading_styles ?? []
  const markets: string[] = profile.main_markets ?? []

  // The first select doesn't expose id; fetch it (plus currency) to load trades.
  const { data: idRow } = await supabase
    .from('profiles').select('id, account_currency').eq('username', profile.username).single()

  type PubTrade = {
    id: string; instrument: string; direction: string; status: string; outcome: string
    entry_price: number; exit_price: number | null; pnl_amount: number | null
    r_multiple: number | null; planned_rr: number | null; traded_at: string; mistake_tags: string[]
  }
  let ptrades: PubTrade[] = []
  const currency = idRow?.account_currency ?? 'USD'
  if (idRow) {
    const { data } = await supabase
      .from('trades')
      .select('id, instrument, direction, status, outcome, entry_price, exit_price, pnl_amount, r_multiple, planned_rr, traded_at, mistake_tags')
      .eq('user_id', idRow.id).eq('is_public', true).eq('status', 'closed')
      .order('traded_at', { ascending: false }).limit(10)
    ptrades = (data ?? []) as PubTrade[]
  }
  const metrics = computeMetrics(ptrades.map((t): TradeForMetrics => ({
    status: 'closed', outcome: t.outcome as TradeForMetrics['outcome'], rMultiple: t.r_multiple,
    pnlAmount: t.pnl_amount, tradedAt: t.traded_at, mistakeTags: t.mistake_tags ?? [],
  })))

  return (
    <main className="ts-page" style={{ maxWidth: 720 }}>
      <div className="ts-card">
        <header className="flex items-center gap-5">
          {profile.avatar_url
            ? <img src={profile.avatar_url} alt="" className="ts-avatar" />
            : <div className="ts-avatar ts-avatar--ph">{initial}</div>}
          <div>
            <h1 className="ts-h1">{name}</h1>
            <p className="muted" style={{ fontWeight: 600 }}>@{profile.username}</p>
          </div>
        </header>

        {profile.bio && <p className="mt-5" style={{ color: 'var(--dim)', maxWidth: '60ch' }}>{profile.bio}</p>}

        {(markets.length > 0 || styles.length > 0) && (
          <div className="mt-5">
            {markets.map((m) => <span key={m} className="ts-tag">{m}</span>)}
            {styles.map((s) => <span key={s} className="ts-tag">{s}</span>)}
          </div>
        )}

        <dl className="ts-statgrid mt-6">
          <div className="ts-stat"><dt>Experience</dt><dd>{profile.experience_level ?? '—'}</dd></div>
          <div className="ts-stat"><dt>Level</dt><dd>Level {profile.level} · {profile.xp} XP</dd></div>
          <div className="ts-stat"><dt>Followers</dt><dd>0 · 0 following</dd></div>
          <div className="ts-stat"><dt>Member since</dt><dd>{new Date(profile.created_at).toLocaleDateString()}</dd></div>
        </dl>
      </div>

      <section className="mt-6">
        <h2 className="ts-h2">Performance</h2>
        <div className="mt-3"><StatsBar m={metrics} currency={idRow?.account_currency ?? 'USD'} /></div>
      </section>

      <section className="mt-6">
        <h2 className="ts-h2">Recent public trades</h2>
        {ptrades.length === 0 ? (
          <p className="ts-placeholder mt-3">No public trades yet.</p>
        ) : (
          <div className="ts-card mt-3" style={{ padding: 8 }}>
            <table className="ts-table">
              <thead><tr><th>Instrument</th><th>Entry</th><th>Exit</th><th>P/L</th><th>R</th></tr></thead>
              <tbody>
                {ptrades.map((t) => (
                  <tr key={t.id}>
                    <td style={{ fontWeight: 600 }}>{t.instrument} <span className="faint" style={{ textTransform: 'capitalize', fontWeight: 400 }}>{t.direction}</span></td>
                    <td>{t.entry_price}</td>
                    <td>{t.exit_price ?? '—'}</td>
                    <td className={t.pnl_amount == null ? '' : t.pnl_amount >= 0 ? 'ts-pos' : 'ts-neg'}>{t.pnl_amount == null ? '—' : `${t.pnl_amount >= 0 ? '+' : '−'}$${Math.abs(t.pnl_amount).toFixed(2)}`}</td>
                    <td>{t.r_multiple != null ? `${t.r_multiple.toFixed(2)}R` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
