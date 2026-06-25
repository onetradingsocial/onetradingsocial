'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { Icon, Avatar, Sparkline } from './atoms'
import { follow, unfollow } from '@/app/actions/social'
import type { HomeData, HomeLeader, HomeRecentTrade, HomeQuest } from './types'

const money = (n: number | null) => n == null ? '—' : `${n >= 0 ? '+' : '−'}$${Math.abs(Math.round(n)).toLocaleString()}`

function RailFollow({ targetId, initial }: { targetId: string; initial: boolean }) {
  const [following, setFollowing] = useState(initial)
  const [pending, start] = useTransition()
  return (
    <button className={'h-btn h-btn-sm ' + (following ? 'h-btn-ghost' : 'h-btn-grad')} style={{ flex: 1 }} disabled={pending}
      onClick={() => { const next = !following; setFollowing(next); start(async () => { const r = next ? await follow(targetId) : await unfollow(targetId); if ('error' in r && r.error) setFollowing(!next) }) }}>
      {following ? <><Icon name="check" size={15} /> Following</> : <><Icon name="plus" size={15} /> Follow</>}
    </button>
  )
}

export function TraderOfWeek({ leader, isFollowing, isSelf }: { leader: HomeLeader | null; isFollowing: boolean; isSelf: boolean }) {
  if (!leader) return null
  return (
    <div className="h-totw">
      <div className="h-totw-top">
        <div className="h-ink-grid" />
        <span className="crown-eyebrow"><span className="crn"><Icon name="crown" size={13} /></span> Trader of the week</span>
        <span className="seed">{leader.trades} trades</span>
      </div>
      <div className="h-totw-body">
        <div className="who">
          <span className="av-medal">
            <Avatar seed={leader.username} src={leader.avatarUrl} name={leader.displayName || leader.username} size={62} ring />
            <span className="badge"><Icon name="crown" size={12} /></span>
          </span>
          <div className="txt">
            <b>@{leader.username}</b>
            <span>{(leader.displayName || leader.username)} · #1 this week</span>
          </div>
        </div>
        <div className="h-totw-stats">
          <div className="m"><div className="k">Weekly P/L</div><div className={'val ' + (leader.pnl >= 0 ? 'h-up' : 'h-down')}>{money(leader.pnl)}</div></div>
          <div className="m"><div className="k">Win rate</div><div className="val">{Math.round(leader.winRate * 100)}%</div></div>
          <div className="m"><div className="k">Trades</div><div className="val">{leader.trades}</div></div>
        </div>
        <div style={{ display: 'flex', gap: 9 }}>
          {!isSelf && <RailFollow targetId={leader.userId} initial={isFollowing} />}
          <Link href={`/${leader.username}`} className="h-btn h-btn-sm h-btn-ghost" style={{ flex: 1 }}><Icon name="journal" size={15} /> View trades</Link>
        </div>
      </div>
    </div>
  )
}

export function TopTraders({ leaders, userId }: { leaders: HomeLeader[]; userId: string }) {
  return (
    <div className="h-w">
      <div className="h-w-h">
        <h3><Icon name="trophy" size={15} style={{ color: 'var(--xp)' }} /> Leaderboard · this week</h3>
        <Link className="h-link" href="/leaderboard">View all</Link>
      </div>
      {leaders.length === 0 && <p style={{ padding: '8px 16px 16px', color: 'var(--faint)', fontSize: 13 }}>No ranked traders yet.</p>}
      {leaders.map((t) => {
        const me = t.userId === userId
        return (
          <Link key={t.userId} href={`/${t.username}`} className={'h-lt g' + t.rank} style={me ? { background: 'rgba(124,92,230,0.06)' } : undefined}>
            <span className="rk">{t.rank}</span>
            <Avatar seed={t.username} src={t.avatarUrl} name={t.displayName || t.username} size={34} ring={t.rank <= 3} />
            <div className="who"><b>@{t.username}{me && <span className="h-mini-lv" style={{ marginLeft: 6 }}>You</span>}</b><span>{Math.round(t.winRate * 100)}% win · {t.trades} trades</span></div>
            <div className="pl"><div className={'v ' + (t.pnl >= 0 ? 'h-up' : 'h-down')}>{money(t.pnl)}</div><div className="sub"><Sparkline seed={t.username.length + t.rank} trend={t.pnl >= 0 ? 2 : -2} color={t.pnl >= 0 ? '#12A56B' : '#E5475D'} fill={false} w={56} h={14} strokeW={1.6} /></div></div>
          </Link>
        )
      })}
    </div>
  )
}

export function Quests({ quests }: { quests: HomeQuest[] }) {
  const completed = quests.filter((q) => q.done).length
  return (
    <div className="h-w">
      <div className="h-w-h">
        <h3><Icon name="target" size={15} style={{ color: 'var(--violet-br)' }} /> Daily quests</h3>
        <Link className="h-link" href="/achievements">{completed}/{quests.length}</Link>
      </div>
      {quests.map((q) => (
        <Link key={q.id} href="/achievements" className={'h-quest' + (q.done ? ' done' : '')} style={{ width: '100%', textAlign: 'left' }}>
          <span className="h-qcheck"><Icon name="check" size={13} /></span>
          <span className="qt"><b>{q.label}</b><span>{q.current}/{q.target}</span></span>
          {!q.done && <span className="qarrow"><Icon name="chevR" size={15} /></span>}
        </Link>
      ))}
    </div>
  )
}

export function RecentTrades({ trades }: { trades: HomeRecentTrade[] }) {
  return (
    <div className="h-w">
      <div className="h-w-h"><h3><Icon name="clock" size={15} /> Recent trades</h3><Link className="h-link" href="/journal">All</Link></div>
      {trades.length === 0 && <p style={{ padding: '8px 16px 16px', color: 'var(--faint)', fontSize: 13 }}>No trades yet.</p>}
      {trades.map((r) => {
        const win = (r.pnl ?? 0) >= 0
        const parts = r.instrument.split('/')
        return (
          <div key={r.id} className="h-rt">
            <span className="sym">{parts[0]}{parts[1] ? <><br />{parts[1]}</> : null}</span>
            <div className="info"><b>{r.instrument}</b><span>{r.label}</span></div>
            <span className="pl" style={{ color: r.status === 'open' ? 'var(--faint)' : win ? 'var(--up)' : 'var(--down)' }}>{r.status === 'open' ? 'Open' : money(r.pnl)}</span>
          </div>
        )
      })}
    </div>
  )
}

export function Rail({ data }: { data: HomeData }) {
  const leader = data.weekLeaders[0] ?? null
  const followingSet = new Set(data.followingIds)
  return (
    <aside className="h-rail">
      <TraderOfWeek leader={leader} isSelf={leader?.userId === data.userId} isFollowing={leader ? followingSet.has(leader.userId) : false} />
      <TopTraders leaders={data.weekLeaders} userId={data.userId} />
      <Quests quests={data.quests} />
      <RecentTrades trades={data.recentTrades} />
    </aside>
  )
}
