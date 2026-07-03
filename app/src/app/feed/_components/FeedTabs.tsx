'use client'

import { useState } from 'react'
import { PostCard, type FeedItem } from './PostCard'

export type FeedTabItem = FeedItem & { fromFollowed: boolean; fromFavorite: boolean }

export function FeedTabs({ items }: { items: FeedTabItem[] }) {
  const [tab, setTab] = useState<'all' | 'following'>('all')
  const shown = tab === 'all' ? items : items.filter((i) => i.fromFollowed)
  return (
    <div>
      <div className="flex items-center justify-between" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
        <h2 className="ts-h2">Community feed</h2>
        <div className="ts-filterbar">
          <button type="button" data-active={tab === 'all'} onClick={() => setTab('all')}>All</button>
          <button type="button" data-active={tab === 'following'} onClick={() => setTab('following')}>Following</button>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {shown.length === 0
          ? <p className="faint" style={{ textAlign: 'center', padding: 30 }}>
              {tab === 'following' ? 'Follow traders to see their posts here.' : 'No posts yet. Be the first to share.'}
            </p>
          : shown.map((p) => <PostCard key={p.id} post={p} />)}
      </div>
    </div>
  )
}
