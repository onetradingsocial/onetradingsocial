'use client'

import Link from 'next/link'
import { Icon, Avatar, StreakChain, Delta } from './atoms'
import { TraderHoverCard } from '@/app/_components/TraderHoverCard'
import type { HomeData } from './types'

const money = (n: number) => `${n >= 0 ? '+' : '−'}$${Math.abs(Math.round(n)).toLocaleString()}`

function leagueFor(rank: number | null, total: number) {
  if (rank == null || total === 0) return 'Unranked'
  const pct = rank / total
  if (rank <= 3 || pct <= 0.05) return 'Diamond League'
  if (pct <= 0.2) return 'Platinum League'
  if (pct <= 0.5) return 'Gold League'
  return 'Silver League'
}

// Approximate the 7-day "don't break the chain" from the win/loss streak + today's logging.
function streakDays(streak: number, loggedToday: number): string[] {
  const done = Math.max(0, Math.min(6, Math.abs(streak)))
  const days: string[] = []
  for (let i = 0; i < 6; i++) days.push(i < done ? 'done' : 'future')
  days.push(loggedToday > 0 ? 'done' : 'today')
  return days
}

export function CmdArena({ data, onOpenTrade }: { data: HomeData; onOpenTrade: () => void }) {
  const { name, viewerRank, totalRanked, streak, weekLeaders, userId, loggedToday } = data
  const days = streakDays(streak, loggedToday)
  const leaderPnl = weekLeaders[0]?.pnl ?? 0
  const race = weekLeaders.slice(0, 3)

  return (
    <section className="h-card h-reveal" style={{ padding: 0, overflow: 'hidden', borderRadius: 'var(--r-lg)', boxShadow: 'var(--sh)' }}>
      <div className="h-arena-split">
        {/* left — standing */}
        <div className="h-arena-stand">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span className="h-eyebrow">Your standing · this week</span>
          </div>
          <div className="h-rankhero">
            <div>
              <span className="h-rankbig h-grad-text">{viewerRank ? `#${viewerRank}` : '—'}</span>
            </div>
            <div style={{ paddingBottom: 4 }}>
              <span className="h-chip" style={{ background: 'var(--xp-soft)', color: 'var(--xp)', fontWeight: 700 }}>
                <Icon name="crown" size={13} /> {leagueFor(viewerRank, totalRanked)}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                {viewerRank ? <Delta v={0} suffix={` of ${totalRanked}`} type="flat" /> : null}
                {streak !== 0 && (
                  <span className="h-chip" style={{ background: 'rgba(255,122,77,0.10)', color: '#E0670F' }}>
                    <Icon name="flame" size={12} style={{ color: '#FF7A4D' }} /> {Math.abs(streak)}-trade {streak > 0 ? 'win' : 'loss'} streak
                  </span>
                )}
              </div>
            </div>
          </div>
          <p style={{ color: 'var(--dim)', fontSize: 14, marginTop: 16, maxWidth: 360 }}>
            Welcome back, <b style={{ color: 'var(--text)' }}>{name}</b>. {viewerRank
              ? <>You&apos;re ranked <b style={{ color: 'var(--text)' }}>#{viewerRank}</b> this week — keep logging to climb.</>
              : <>Log your trades this week to enter the rankings.</>}
          </p>
          <div style={{ marginTop: 18 }}>
            <div className="h-mono" style={{ fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 8 }}>Don&apos;t break the chain</div>
            <StreakChain days={days} />
          </div>
          <div className="h-arena-cta" style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button className="h-btn h-btn-grad" onClick={onOpenTrade}><Icon name="bolt" size={16} /> Log a trade</button>
            <Link href="/journal" className="h-btn h-btn-ghost"><Icon name="journal" size={16} /> Open journal</Link>
          </div>
        </div>

        {/* right — the race */}
        <div className="h-arena-race">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <span className="h-eyebrow">The race · top this week</span>
            <Link className="h-link" href="/leaderboard">Full board <Icon name="chevR" size={13} /></Link>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {race.length === 0 && <p style={{ color: 'var(--faint)', fontSize: 13.5 }}>No ranked traders yet this week. Be the first.</p>}
            {race.map((r) => {
              const me = r.userId === userId
              const gap = r.rank === 1 ? 'Leading' : `${money(leaderPnl - r.pnl).replace('+', '')} behind`
              const idRow = (
                <>
                  <Avatar seed={r.username} src={r.avatarUrl} name={r.displayName || r.username} size={34} ring={me} />
                  <div style={{ minWidth: 0 }}>
                    <b style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>@{r.username}{me && <span className="h-mini-lv">You</span>}</b>
                    <span className="h-mono" style={{ fontSize: 11, color: me ? 'var(--violet-br)' : 'var(--faint)' }}>{gap}</span>
                  </div>
                </>
              )
              return (
                <div key={r.userId} className={'h-vsrow' + (me ? ' me' : '')}>
                  <span className="pos">{r.rank}</span>
                  {me
                    ? idRow
                    : <TraderHoverCard userId={r.userId} username={r.username} displayName={r.displayName} avatarUrl={r.avatarUrl} wrapClassName="thc-wrap">{idRow}</TraderHoverCard>}
                  <span className={'h-mono ' + (r.pnl >= 0 ? 'h-up' : 'h-down')} style={{ marginLeft: 'auto', fontWeight: 700, fontSize: 14 }}>{money(r.pnl)}</span>
                </div>
              )
            })}
          </div>
          <div style={{ marginTop: 'auto', paddingTop: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center', background: 'var(--grad-soft)', border: '1px solid var(--line-vio)', color: 'var(--violet-br)', flexShrink: 0 }}>
              <Icon name="bolt" size={18} />
            </span>
            <div style={{ fontSize: 13, color: 'var(--dim)', lineHeight: 1.4 }}>
              <b style={{ color: 'var(--text)' }}>Log consistently</b> to climb the weekly board and defend your rank.
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
