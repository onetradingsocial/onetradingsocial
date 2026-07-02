import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient, getSessionUser } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { RESERVED_USERNAMES } from '@/lib/username'
import { computeMetrics, type TradeForMetrics } from '@/lib/trade'
import { calendarCells, MONTHS, type JTrade } from '@/lib/journal-stats'
import { FollowButton } from '@/app/_components/FollowButton'
import { getPerformanceRanking } from '@/lib/server/ranking'
import { getUserXp } from '@/lib/server/xp'
import { getTier } from '@/lib/server/entitlements'
import { canFlag } from '@/lib/feature-flags'
import { getFeatureFlags } from '@/lib/server/feature-flags'
import { areMutualFollowers } from '@/lib/server/messaging'
import { TradingCalendar } from '@/app/journal/_components/TradingCalendar'
import { Icon } from './_components/Icon'
import { Sparkline } from './_components/Sparkline'
import { ProfileEquity, type EqPoint } from './_components/ProfileEquity'
import { LogTradeBand } from './_components/LogTradeBand'
import './profile.css'
import '@/app/feed/_components/home/home-arena.css'

const BADGE_ICON: Record<string, string> = { trades: 'journal', level: 'shield', questStreak: 'flame', winStreak: 'target', lessons: 'book' }
const BADGE_GRAD: Record<string, string> = {
  trades: 'linear-gradient(135deg,#7C5CE6,#C840BC)', level: 'linear-gradient(135deg,#3FB6E8,#1A86B8)',
  questStreak: 'linear-gradient(135deg,#FF7A4D,#E0931E)', winStreak: 'linear-gradient(135deg,#12A56B,#3FB6E8)',
  lessons: 'linear-gradient(135deg,#FFE08A,#E3A92B)',
}

export default async function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params
  if ((RESERVED_USERNAMES as readonly string[]).includes(username.toLowerCase())) notFound()

  const supabase = await createClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('username, display_name, bio, avatar_url, experience_level, main_markets, trading_styles, created_at')
    .eq('username', username)
    .maybeSingle()

  // RLS hides private profiles from non-owners -> no row -> 404 (no existence leak).
  if (!profile) notFound()

  const name = profile.display_name ?? profile.username
  const initial = name.charAt(0).toUpperCase()
  const styles: string[] = profile.trading_styles ?? []
  const markets: string[] = profile.main_markets ?? []

  const { data: idRow } = await supabase
    .from('profiles').select('id, account_currency').eq('username', profile.username).single()
  const profileId = idRow?.id
  const currency = idRow?.account_currency ?? 'USD'
  const money = (n: number, sign = false) => {
    const sym = currency === 'USD' ? '$' : ''
    const abs = `${sym}${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    if (n < 0) return `−${abs}`
    return sign ? `+${abs}` : abs
  }

  const viewer = await getSessionUser(supabase)
  let followerCount = 0, followingCount = 0, isFollowing = false
  let followers: { avatar_url: string | null; display_name: string | null; username: string }[] = []
  if (profileId) {
    const fc = await supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', profileId)
    const gc = await supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', profileId)
    followerCount = fc.count ?? 0
    followingCount = gc.count ?? 0
    // Avatars of this profile's followers (the .h-av stack in the hero).
    const { data: frows } = await supabase
      .from('follows')
      .select('follower:profiles!follows_follower_id_fkey(username, display_name, avatar_url)')
      .eq('following_id', profileId).limit(5)
    followers = (frows ?? [])
      .map((r) => (Array.isArray(r.follower) ? r.follower[0] : r.follower))
      .filter(Boolean) as typeof followers
    if (viewer && viewer.id !== profileId) {
      const { data: vf } = await supabase.from('follows')
        .select('follower_id').eq('follower_id', viewer.id).eq('following_id', profileId).maybeSingle()
      isFollowing = !!vf
    }
  }
  const isSelf = !!(viewer && profileId && viewer.id === profileId)
  const canMsg = viewer && profileId && !isSelf ? await areMutualFollowers(supabase, viewer.id, profileId) : false

  // All public closed trades — single source for stats, equity, calendar, history, instruments.
  let pub: JTrade[] = []
  if (idRow) {
    const { data } = await supabase
      .from('trades')
      .select('id, instrument, market, direction, status, outcome, entry_price, exit_price, r_multiple, pnl_amount, planned_rr, setup_type, strategy_tags, traded_at')
      .eq('user_id', idRow.id).eq('is_public', true).eq('status', 'closed')
      .order('traded_at', { ascending: false })
    pub = (data ?? []) as JTrade[]
  }

  const metrics = computeMetrics(pub.map((t): TradeForMetrics => ({
    status: 'closed', outcome: t.outcome as TradeForMetrics['outcome'], rMultiple: t.r_multiple,
    pnlAmount: t.pnl_amount, tradedAt: t.traded_at, mistakeTags: [],
  })))

  // Equity curve points (ascending, cumulative) + derived equity stats.
  const asc = [...pub].sort((a, b) => a.traded_at.localeCompare(b.traded_at))
  let cum = 0
  const eqPoints: EqPoint[] = asc.map((t) => { cum += t.pnl_amount ?? 0; return { t: Date.parse(t.traded_at), v: cum } })
  const dayNet: Record<string, number> = {}
  for (const t of asc) { const d = t.traded_at.slice(0, 10); dayNet[d] = (dayNet[d] ?? 0) + (t.pnl_amount ?? 0) }
  const bestDay = Object.values(dayNet).reduce((m, v) => Math.max(m, v), 0)
  const avgTrade = metrics.total ? metrics.netPnl / metrics.total : 0
  const eqstats = [
    { k: 'Best day', v: money(bestDay, true), up: bestDay > 0 },
    { k: 'Avg / trade', v: money(avgTrade, true), up: avgTrade > 0 },
    { k: 'Win streak', v: String(Math.max(0, metrics.currentStreak)) },
    { k: 'Profit factor', v: metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2) },
  ]

  // Most-traded instruments (top 5, share of public closed trades).
  const instCounts: Record<string, number> = {}
  for (const t of pub) instCounts[t.instrument] = (instCounts[t.instrument] ?? 0) + 1
  const topInst = Object.entries(instCounts)
    .map(([pair, count]) => ({ pair, pct: Math.round((count / (pub.length || 1)) * 100) }))
    .sort((a, b) => b.pct - a.pct).slice(0, 5)

  // Calendar (current month) — reuses the journal calendar component.
  const now = new Date()
  const year = now.getFullYear(), month = now.getMonth()
  const cal = calendarCells(pub, year, month)

  // Ranking / standing.
  let profileRank: number | null = null
  let leaderPnl: number | null = null, leaderHandle: string | null = null, standingPnl = metrics.netPnl
  if (profileId) {
    const board = await getPerformanceRanking(supabase, 'all')
    const mine = board.find((e) => e.userId === profileId)
    profileRank = mine?.rank ?? null
    if (mine) standingPnl = mine.pnl
    if (board[0]) { leaderPnl = board[0].pnl; leaderHandle = board[0].username }
  }

  // Pro badge (service client so cross-viewer RLS doesn't hide the owner's subscription).
  let proBadge = false
  if (profileId) proBadge = canFlag(await getFeatureFlags(), await getTier(createServiceClient(), profileId), 'pro_badge')

  const profileXp = profileId ? await getUserXp(supabase, profileId, { publicOnly: true }) : null
  const badges = profileXp?.badges ?? []
  const earnedCount = badges.filter((b) => b.earned).length

  // Trading-style rows (only those backed by data).
  const styleRows: { icon: string; lab: string; val?: string; chips?: string[]; mono?: boolean; plain?: boolean }[] = []
  if (topInst.length > 0) styleRows.push({ icon: 'chart', lab: 'Preferred Instruments', chips: topInst.slice(0, 3).map((i) => i.pair), mono: true })
  else if (markets.length > 0) styleRows.push({ icon: 'chart', lab: 'Main Markets', chips: markets, plain: true })
  if (styles.length > 0) styleRows.push({ icon: 'target', lab: 'Market Approach', chips: styles })
  if (profile.experience_level) styleRows.push({ icon: 'shield', lab: 'Experience', val: profile.experience_level })

  // Running per-metric series (ascending) so each card's sparkline reflects its data.
  const pnlSeries = eqPoints.map((p) => p.v)
  const winRateSeries: number[] = []
  const avgRSeries: number[] = []
  const countSeries: number[] = []
  let wRun = 0, rSum = 0, rN = 0
  asc.forEach((t, i) => {
    if ((t.r_multiple ?? 0) > 0) wRun++
    winRateSeries.push((wRun / (i + 1)) * 100)
    if (t.r_multiple != null) { rSum += t.r_multiple; rN++ }
    avgRSeries.push(rN ? rSum / rN : 0)
    countSeries.push(i + 1)
  })

  const statCards = [
    { k: 'Overall Rank', v: profileRank ? `#${profileRank}` : 'Unranked', accent: '#E0931E', data: pnlSeries },
    { k: 'Total P/L', v: money(metrics.netPnl, true), accent: '#12A56B', data: pnlSeries },
    { k: 'Win Rate', v: `${Math.round(metrics.winRate * 100)}%`, accent: '#7C5CE6', data: winRateSeries },
    { k: 'Avg R:R', v: metrics.avgRr.toFixed(1), accent: '#3FB6E8', data: avgRSeries },
    { k: 'Total Trades', v: String(metrics.total), accent: '#C840BC', data: countSeries },
  ]

  const history = pub.slice(0, 5)
  const monthLabel = `${MONTHS[month]} ${year}`

  return (
    <div className="h-app">
      <div className="h-main">
        <div className="h-grid">
          <div className="h-col" style={{ gap: 22 }}>

            {/* ---------- HERO ---------- */}
            <div className="pf-hero h-reveal">
              <div className="pf-cover">
                <span className="pf-blob b1" /><span className="pf-blob b2" /><span className="pf-blob b3" />
                <div className="h-ink-grid" />
                <svg className="pf-cover-line" viewBox="0 0 1000 90" preserveAspectRatio="none">
                  <defs><linearGradient id="pfcvfill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#fff" stopOpacity="0.18" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
                  </linearGradient></defs>
                  <path d="M0 70 L90 58 L180 64 L270 40 L360 50 L450 30 L540 38 L630 18 L720 26 L810 12 L900 20 L1000 4 L1000 90 L0 90 Z" fill="url(#pfcvfill)" />
                  <path d="M0 70 L90 58 L180 64 L270 40 L360 50 L450 30 L540 38 L630 18 L720 26 L810 12 L900 20 L1000 4" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                </svg>
              </div>
              <div className="pf-hero-body">
                <div className="pf-idrow">
                  <div className="pf-av">
                    <span className="pf-av-ring">
                      {profile.avatar_url
                        ? <img src={profile.avatar_url} alt="" style={{ width: 104, height: 104, borderRadius: '50%', objectFit: 'cover', display: 'block' }} />
                        : <span className="lb-av" style={{ width: 104, height: 104, fontSize: 42 }}>{initial}</span>}
                    </span>
                  </div>
                  <div className="pf-id">
                    <div className="pf-name">
                      {name}
                      {proBadge && <span className="pf-verified" title="Pro"><Icon name="check" size={13} /></span>}
                      {profileXp && <span className="pf-lvtag">LV {profileXp.level.level}</span>}
                    </div>
                    <div className="pf-handle">@{profile.username}</div>
                    <div className="pf-meta">
                      {profileRank && <span className="pf-metaitem"><Icon name="trophy" size={14} /> Rank #{profileRank}</span>}
                      <span className="pf-metaitem"><Icon name="clock" size={14} /> Joined {new Date(profile.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</span>
                    </div>
                  </div>
                  <div className="pf-actions">
                    {isSelf ? (
                      <>
                        <Link href="/settings" className="h-btn h-btn-grad"><Icon name="pencil" size={16} /> Edit profile</Link>
                        <Link href="/settings" className="pf-iconbtn" title="Settings"><Icon name="sliders" size={18} /></Link>
                      </>
                    ) : (
                      <>
                        {viewer && profileId && <FollowButton targetId={profileId} initialFollowing={isFollowing} />}
                        {canMsg && <Link href={`/messages?to=${profile.username}`} className="h-btn h-btn-grad">Message</Link>}
                      </>
                    )}
                  </div>
                </div>

                {profile.bio && <p className="pf-bio">{profile.bio}</p>}

                <div className="pf-social">
                  <div className="pf-soc"><span className="n">{followerCount.toLocaleString()}</span><span className="k">Followers</span></div>
                  <div className="pf-soc"><span className="n">{followingCount.toLocaleString()}</span><span className="k">Following</span></div>
                  <div className="pf-soc"><span className="n">{pub.length.toLocaleString()}</span><span className="k">Trades shared</span></div>
                  {metrics.currentStreak > 0 && (
                    <div className="pf-soc last"><span className="n">{metrics.currentStreak}</span><span className="k">Win streak</span></div>
                  )}
                  {followerCount > 0 && (
                    <div className="pf-followers">
                      {followers.length > 0 && (
                        <div className="stack">
                          {followers.map((f) => (
                            <span key={f.username} className="h-av" style={{ width: 32, height: 32, ...(f.avatar_url ? { backgroundImage: `url(${f.avatar_url})` } : {}) }} />
                          ))}
                        </div>
                      )}
                      <span className="more">
                        {followers[0] && <b>{followers[0].display_name ?? followers[0].username}</b>}
                        {followers[0] && followerCount > 1 ? <> &amp; <b>{(followerCount - 1).toLocaleString()} others</b> follow</> : ' follows'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ---------- LOG TRADE (self only) ---------- */}
            {isSelf && <LogTradeBand />}

            {/* ---------- STATS ---------- */}
            <div className="h-reveal" style={{ animationDelay: '.04s' }}>
              <div className="h-section-h" style={{ marginBottom: 12 }}>
                <h2>Performance overview</h2>
                {isSelf && <Link className="h-link" href="/journal">Open journal <Icon name="chevR" size={13} /></Link>}
              </div>
              <div className="h-stats">
                {statCards.map((s) => (
                  <div key={s.k} className="h-stat" style={{ '--accent': s.accent } as React.CSSProperties}>
                    <div className="top"><span className="k">{s.k}</span></div>
                    <div className="v">{s.v}</div>
                    <div className="spark"><Sparkline data={s.data} color={s.accent} h={28} /></div>
                  </div>
                ))}
              </div>
            </div>

            {/* ---------- EQUITY ---------- */}
            <ProfileEquity points={eqPoints} eqstats={eqstats} currency={currency} />

            {/* ---------- TRADING STYLE ---------- */}
            {styleRows.length > 0 && (
              <div className="lb-panel h-reveal">
                <div className="lb-panel-h"><h2>Trading style</h2><span className="lb-section-sub">How {name.split(' ')[0]} trades</span></div>
                <div className="pf-style">
                  {styleRows.map((row, i) => (
                    <div key={i} className="pf-strow">
                      <span className="lab"><span className="ic"><Icon name={row.icon} size={13} /></span>{row.lab}</span>
                      {row.val && <div className="val">{row.val}</div>}
                      {row.chips && (
                        <div className="pf-chiprow">
                          {row.chips.map((c) => (
                            <span key={c} className={'pf-tchip' + (row.plain ? ' plain' : '')}>
                              {row.mono && c.includes('/') && <span className="mk">{c.split('/')[0]}</span>}{c}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ---------- P/L CALENDAR (journal component) ---------- */}
            <div className="h-reveal">
              <TradingCalendar cells={cal} monthLabel={monthLabel} today={now.getDate()} trades={pub} year={year} month={month} />
            </div>

            {/* ---------- TRADE HISTORY ---------- */}
            <div className="lb-panel h-reveal">
              <div className="lb-panel-h"><h2>Recent trades</h2>{isSelf && <Link className="h-link" href="/journal">View all <Icon name="chevR" size={13} /></Link>}</div>
              {history.length === 0 ? (
                <div className="lb-empty">No public trades yet.</div>
              ) : (
                <div className="pf-hist">
                  {history.map((t) => {
                    const [a, b] = t.instrument.includes('/') ? t.instrument.split('/') : [t.instrument, '']
                    const long = t.direction === 'long'
                    const note = t.setup_type || (t.strategy_tags ?? [])[0] || `${t.market}`
                    const pnl = t.pnl_amount
                    return (
                      <div key={t.id} className="pf-hrow">
                        <span className="pf-hsym">{a}{b && <><br />{b}</>}</span>
                        <div className="pf-hmain">
                          <div className="top">
                            <span className="pair">{t.instrument}</span>
                            <span className={'pf-hdir ' + (long ? 'long' : 'short')}><Icon name={long ? 'arrowUp' : 'arrowDown'} size={10} />{t.direction}</span>
                          </div>
                          <div className="note" style={{ textTransform: 'capitalize' }}>{note}</div>
                        </div>
                        <div className="pf-hmeta">
                          <div className="col hidem"><div className="k">R:R</div><div className="v">{t.r_multiple != null ? `${t.r_multiple.toFixed(1)}R` : '—'}</div></div>
                          <div className="col"><div className="k">Net P/L</div><div className={'v ' + (pnl == null ? '' : pnl >= 0 ? 'up' : 'down')}>{pnl == null ? '—' : money(pnl, true)}</div></div>
                          <div className="col hidem"><div className="k">Closed</div><div className="date">{new Date(t.traded_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div></div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* ---------- ACHIEVEMENTS ---------- */}
            {badges.length > 0 && (
              <div className="lb-panel h-reveal">
                <div className="lb-panel-h"><h2>Achievements</h2><span className="lb-section-sub">{earnedCount} of {badges.length} unlocked</span></div>
                <div className="pf-badges">
                  {[...badges].sort((x, y) => Number(y.earned) - Number(x.earned)).map((b) => {
                    const sub = b.earned
                      ? ({ trades: `${b.threshold} trades logged`, level: `Reached level ${b.threshold}`, questStreak: `${b.threshold}-day quest streak`, winStreak: `${b.threshold} wins in a row`, lessons: `${b.threshold} lessons done` }[b.category])
                      : `${Math.max(0, b.threshold - b.current)} more to unlock`
                    return (
                      <div key={b.id} className={'pf-badge' + (b.earned ? ' earned' : ' locked')}>
                        {b.earned && <span className="got"><Icon name="check" size={16} /></span>}
                        <span className="ic" style={b.earned ? { background: BADGE_GRAD[b.category] } : undefined}><Icon name={BADGE_ICON[b.category]} size={21} /></span>
                        <b>{b.label}</b>
                        <span>{sub}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ---------- RAIL ---------- */}
          <aside className="h-rail">
            <div className="lb-standing">
              <div className="h-ink-grid" />
              <span className="eyebrow">{isSelf ? 'Your standing' : 'Standing'} · all-time</span>
              {profileRank ? (
                <>
                  <div className="bigrow">
                    <span className="bigrank h-grad-text">#{profileRank}</span>
                  </div>
                  <div className="pods">
                    <div className="pod"><div className="k">Total P/L</div><div className="v" style={{ color: standingPnl >= 0 ? 'var(--up-ink)' : 'var(--down-ink)' }}>{money(standingPnl, true)}</div></div>
                    <div className="pod"><div className="k">Win rate</div><div className="v">{Math.round(metrics.winRate * 100)}%</div></div>
                  </div>
                  {profileRank > 1 && leaderHandle && leaderPnl != null && (
                    <div className="nextrow">
                      <div className="lab"><span>Gap to <b>#1 @{leaderHandle}</b></span><span><b>{money(Math.max(0, leaderPnl - standingPnl))}</b> behind</span></div>
                      <div className="h-bar"><i style={{ width: (leaderPnl > 0 ? Math.min(100, Math.max(4, Math.round((standingPnl / leaderPnl) * 100))) : 100) + '%' }} /></div>
                    </div>
                  )}
                </>
              ) : (
                <p className="lb-standing-empty">Log public closed trades to earn a rank and climb the board.</p>
              )}
            </div>

            {topInst.length > 0 && (
              <div className="h-w">
                <div className="h-w-h"><h3><Icon name="chart" size={15} style={{ color: 'var(--violet-br)' }} /> Most traded</h3><span className="h-mono" style={{ fontSize: 11, color: 'var(--faint)' }}>{pub.length} trades</span></div>
                <div className="pf-inst">
                  {topInst.map((p) => (
                    <div key={p.pair} className="pf-instrow">
                      <span className="pair">{p.pair}</span>
                      <span className="barwrap"><i style={{ width: p.pct + '%' }} /></span>
                      <span className="pct">{p.pct}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}
