'use client'

import { useMemo, useState } from 'react'
import { FollowButton } from '@/app/_components/FollowButton'
import { TraderHoverCard } from '@/app/_components/TraderHoverCard'
import { Avatar } from './Avatar'

export type XpRow = {
  rank: number; userId: string; username: string; displayName: string | null; avatarUrl: string | null
  xp: number; level: number
}

const PAGE_SIZE = 8

export function XpTable({ rows, viewerId }: { rows: XpRow[]; viewerId: string }) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => (r.displayName ?? '').toLowerCase().includes(q) || r.username.toLowerCase().includes(q))
  }, [query, rows])

  if (rows.length === 0) {
    return <div className="lb-panel lb-empty">No XP earned in this window yet — log public trades to climb.</div>
  }

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pages - 1)
  const slice = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)
  const from = filtered.length ? safePage * PAGE_SIZE + 1 : 0
  const to = Math.min(filtered.length, (safePage + 1) * PAGE_SIZE)

  return (
    <div className="lb-panel">
      <div className="lb-panel-h" style={{ flexWrap: 'wrap', rowGap: 10 }}>
        <h2>All Traders</h2>
        <div className="lb-toolbar">
          <div className="lb-pager">
            <span className="cnt">{from}–{to} of {filtered.length}</span>
            <button className="lb-pgbtn" disabled={safePage === 0} onClick={() => setPage(safePage - 1)} aria-label="Previous page">‹</button>
            <button className="lb-pgbtn" disabled={safePage >= pages - 1} onClick={() => setPage(safePage + 1)} aria-label="Next page">›</button>
          </div>
          <label className="lb-tsearch">
            <span aria-hidden>⌕</span>
            <input placeholder="Search traders…" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0) }} />
          </label>
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="lb-table">
          <thead><tr><th style={{ width: 64 }}>Rank</th><th>Trader</th><th className="num">Level</th><th className="num">XP</th><th className="num">Action</th></tr></thead>
          <tbody>
            {slice.map((t) => {
              const self = t.userId === viewerId
              return (
                <tr key={t.userId} className={self ? 'me' : ''}>
                  <td><span className={'lb-rk' + (t.rank <= 3 ? ' g' + t.rank : '')}>{t.rank}</span></td>
                  <td>
                    <div className="lb-trader">
                      <TraderHoverCard userId={t.userId} username={t.username} displayName={t.displayName} avatarUrl={t.avatarUrl}>
                        <Avatar src={t.avatarUrl} name={t.displayName || t.username} size={38} ring={t.rank <= 3} />
                        <div className="who" style={{ minWidth: 0 }}>
                          <b>{t.displayName || t.username}{self && <span className="lb-you">You</span>}</b>
                          <span>@{t.username}</span>
                        </div>
                      </TraderHoverCard>
                    </div>
                  </td>
                  <td className="num"><span className="lb-cellnum">Lvl {t.level}</span></td>
                  <td className="num"><span className="lb-cellnum">{t.xp.toLocaleString()}</span></td>
                  <td className="num">{self ? <span className="lb-act self">You</span> : <FollowButton targetId={t.userId} initialFollowing={false} />}</td>
                </tr>
              )
            })}
            {slice.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: '34px 0', color: 'var(--faint)' }}>No traders match "{query}".</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
