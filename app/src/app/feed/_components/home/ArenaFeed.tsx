'use client'

import { useMemo, useState } from 'react'
import { Composer } from './Composer'
import { ArenaPostCard } from './ArenaPostCard'
import type { HomeData } from './types'

const SEGS: [string, string][] = [['all', 'All trades'], ['following', 'Following'], ['trending', 'Trending']]

export function ArenaFeed({ data }: { data: HomeData }) {
  const [filter, setFilter] = useState('all')
  const followingSet = useMemo(() => new Set(data.followingIds), [data.followingIds])

  const list = useMemo(() => {
    if (filter === 'following') return data.feedItems.filter((p) => p.fromFollowed)
    if (filter === 'trending') return [...data.feedItems].sort((a, b) => (b.likeCount + b.commentCount) - (a.likeCount + a.commentCount))
    return data.feedItems
  }, [filter, data.feedItems])

  return (
    <div className="h-col">
      <Composer data={data} />
      <div className="h-section-h">
        <h2>Community feed</h2>
        <div className="h-segs">
          {SEGS.map(([k, l]) => (
            <button key={k} className={'h-seg' + (filter === k ? ' on' : '')} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
      </div>
      {list.length === 0
        ? <div className="h-w" style={{ padding: '34px 18px', textAlign: 'center', color: 'var(--faint)', fontSize: 13.5 }}>
            {filter === 'following' ? 'Trades from people you follow will show here.' : 'No trades yet. Be the first to log one.'}
          </div>
        : list.map((item) => <ArenaPostCard key={item.id} item={item} isFollowing={followingSet.has(item.author.id)} />)}
    </div>
  )
}
