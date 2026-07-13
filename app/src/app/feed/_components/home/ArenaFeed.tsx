'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Composer } from './Composer'
import { ArenaPostCard } from './ArenaPostCard'
import { loadOlderFeed } from '@/app/actions/feed'
import type { FeedTabItem } from '../FeedTabs'
import type { HomeData } from './types'

const SEGS: [string, string][] = [['all', 'All trades'], ['following', 'Following'], ['trending', 'Trending']]

export function ArenaFeed({ data }: { data: HomeData }) {
  const [filter, setFilter] = useState('all')
  const [older, setOlder] = useState<FeedTabItem[]>([])
  const [hasMore, setHasMore] = useState(data.feedHasMore)
  const [loading, setLoading] = useState(false)
  const busyRef = useRef(false)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const followingSet = useMemo(() => new Set(data.followingIds), [data.followingIds])

  const allItems = useMemo(() => {
    const seen = new Set(data.feedItems.map((p) => p.id))
    return [...data.feedItems, ...older.filter((p) => !seen.has(p.id))]
  }, [data.feedItems, older])

  const list = useMemo(() => {
    if (filter === 'following') return allItems.filter((p) => p.fromFollowed)
    if (filter === 'trending') return [...allItems].sort((a, b) => (b.likeCount + b.commentCount) - (a.likeCount + a.commentCount))
    return allItems
  }, [filter, allItems])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasMore) return
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting || busyRef.current) return
      // Cursor = oldest post loaded so far; pages are strictly older than it.
      const oldest = [...data.feedItems, ...older]
        .reduce<string | null>((min, p) => (min === null || p.created_at < min ? p.created_at : min), null)
      if (!oldest) return
      busyRef.current = true
      setLoading(true)
      loadOlderFeed(oldest)
        .then((page) => {
          setOlder((prev) => {
            const seen = new Set([...data.feedItems, ...prev].map((p) => p.id))
            return [...prev, ...page.items.filter((p) => !seen.has(p.id))]
          })
          setHasMore(page.hasMore)
        })
        .finally(() => { busyRef.current = false; setLoading(false) })
    }, { rootMargin: '600px 0px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, older, data.feedItems])

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
      {hasMore && (
        <div ref={sentinelRef} className="h-feed-sentinel" style={{ padding: '18px 0', textAlign: 'center', color: 'var(--faint)', fontSize: 13 }}>
          {loading ? 'Loading more trades…' : ' '}
        </div>
      )}
    </div>
  )
}
