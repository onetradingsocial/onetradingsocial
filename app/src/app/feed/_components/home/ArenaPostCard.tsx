'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Icon, Avatar, TradeChart } from './atoms'
import { TraderHoverCard } from '@/app/_components/TraderHoverCard'
import { CommentThread } from '../CommentThread'
import { follow, unfollow, deletePost, toggleLike } from '@/app/actions/social'
import { ImageGallery } from '../attachments/ImageGallery'
import { PollAttachment } from '../attachments/PollAttachment'
import type { TradeCard } from '../attachments/TradeAttachment'
import type { FeedTabItem } from '../FeedTabs'
import { timeAgo } from '@/lib/time'

function money(n: number | null) { return n == null ? '—' : `${n >= 0 ? '+' : '−'}$${Math.abs(n).toFixed(0)}` }

function LikeReact({ postId, initialLiked, initialCount }: { postId: string; initialLiked: boolean; initialCount: number }) {
  const [liked, setLiked] = useState(initialLiked)
  const [count, setCount] = useState(initialCount)
  const [pending, start] = useTransition()
  return (
    <button className={'h-react' + (liked ? ' liked' : '')} disabled={pending}
      onClick={() => {
        const next = !liked; setLiked(next); setCount((c) => c + (next ? 1 : -1))
        start(async () => {
          const r = await toggleLike(postId)
          if ('liked' in r) { setLiked(r.liked); setCount(r.count) }
          else { setLiked(!next); setCount((c) => c + (next ? -1 : 1)) }
        })
      }}>
      <Icon name="heart" size={16} style={liked ? { fill: 'currentColor' } : undefined} /> {count}
    </button>
  )
}

function FollowChip({ targetId, initial }: { targetId: string; initial: boolean }) {
  const [following, setFollowing] = useState(initial)
  const [pending, start] = useTransition()
  return (
    <button className={'h-followbtn h-trade-follow' + (following ? ' on' : '')} disabled={pending}
      onClick={() => { const next = !following; setFollowing(next); start(async () => { const r = next ? await follow(targetId) : await unfollow(targetId); if ('error' in r && r.error) setFollowing(!next) }) }}>
      {following ? <><Icon name="check" size={13} /> Following</> : <><Icon name="plus" size={13} /> Follow</>}
    </button>
  )
}

function TradeBody({ t, note }: { t: TradeCard; note: string }) {
  const long = t.direction === 'long'
  const win = (t.r_multiple ?? t.pnl_amount ?? 0) >= 0
  const result = t.status === 'open' ? 'Open'
    : t.r_multiple == null ? '—'
    : `${win ? 'Win' : 'Loss'} · ${t.r_multiple >= 0 ? '+' : ''}${t.r_multiple.toFixed(1)}R`
  const tags = [t.setup_type, ...(t.strategy_tags ?? [])].filter(Boolean) as string[]
  const seed = t.instrument.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  return (
    <>
      <div className="h-trade-pos">
        <span className="h-pos-pair">{t.instrument}</span>
        <span className={'h-dir ' + (long ? 'long' : 'short')}>
          <Icon name={long ? 'arrowUp' : 'arrowDown'} size={12} />{long ? 'long' : 'short'}
        </span>
        <span className="h-chip" style={{ marginLeft: 'auto', background: t.status === 'open' ? 'var(--sunk)' : win ? 'var(--up-soft)' : 'var(--down-soft)', color: t.status === 'open' ? 'var(--dim)' : win ? 'var(--up)' : 'var(--down)' }}>{result}</span>
      </div>
      <div className="h-trade-body">
        <div className="h-chart">
          <span className="badge">{t.instrument}</span>
          {t.screenshot_url
            ? <img src={t.screenshot_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <TradeChart seed={seed} dir={long ? 'long' : 'short'} win={win} />}
        </div>
        <div className="h-tstats">
          <div className="m"><div className="k">Entry</div><div className="val">{t.entry_price}</div></div>
          <div className="m"><div className="k">Exit</div><div className="val">{t.exit_price ?? '—'}</div></div>
          <div className="m big">
            <div><div className="k">Net P/L</div><div className="val" style={{ color: t.pnl_amount == null ? 'var(--text)' : t.pnl_amount >= 0 ? 'var(--up)' : 'var(--down)' }}>{money(t.pnl_amount)}</div></div>
            <span className="h-mono" style={{ fontSize: 12, color: 'var(--faint)' }}>{t.realized_pips != null ? `${t.realized_pips >= 0 ? '+' : ''}${t.realized_pips.toFixed(1)} pips` : ''}</span>
          </div>
        </div>
      </div>
      {tags.length > 0 && <div className="h-trade-tags">{tags.map((tg, i) => <span key={i} className="h-tag h-tag-strat">{tg}</span>)}</div>}
      {note.trim() && <p className="h-trade-note">{note}</p>}
    </>
  )
}

export function ArenaPostCard({ item, isFollowing }: { item: FeedTabItem; isFollowing: boolean }) {
  const router = useRouter()
  const [showComments, setShowComments] = useState(false)
  const [commentCount, setCommentCount] = useState(item.commentCount)
  const [, start] = useTransition()
  const a = item.author
  const isTrade = item.attachment.type === 'trade'

  return (
    <article className="h-trade">
      <div className="h-trade-h">
        <TraderHoverCard userId={a.id} username={a.username} displayName={a.display_name} avatarUrl={a.avatar_url}>
          <Avatar seed={a.username} src={a.avatar_url} name={a.display_name || a.username} size={40} ring />
          <div className="who">
            <b>
              <Link href={`/${a.username}`}>{a.display_name || a.username}</Link>
              {item.fromFavorite && <Icon name="star" size={13} style={{ color: 'var(--xp)' }} />}
            </b>
            <div className="meta"><span>@{a.username}</span><span>·</span><span>{timeAgo(item.created_at)}</span></div>
          </div>
        </TraderHoverCard>
        {item.isOwn
          ? <button className="h-followbtn on" onClick={() => start(async () => { await deletePost(item.id); router.refresh() })}>Delete</button>
          : <FollowChip targetId={a.id} initial={isFollowing} />}
      </div>

      {/* text body — for trade posts the note renders inside the trade body */}
      {!isTrade && item.body.trim() && <p className="h-trade-note" style={{ paddingTop: 0, paddingBottom: 2 }}>{item.body}</p>}

      {item.attachment.type === 'trade' && <TradeBody t={item.attachment.trade} note={item.body} />}
      {item.attachment.type === 'images' && <div style={{ padding: '12px 17px 0' }}><ImageGallery urls={item.attachment.images} /></div>}
      {item.attachment.type === 'poll' && <div style={{ padding: '12px 17px 0' }}><PollAttachment postId={item.id} options={item.attachment.options} votes={item.attachment.votes} myVote={item.attachment.myVote} /></div>}

      <div className="h-trade-f">
        <LikeReact postId={item.id} initialLiked={item.viewerLiked} initialCount={item.likeCount} />
        <button className="h-react" onClick={() => setShowComments((o) => !o)}><Icon name="chat" size={16} /> {commentCount}</button>
        <button className="h-react h-react-copy" disabled title="Copy to journal — coming soon"><Icon name="copy" size={15} /> Copy to journal</button>
      </div>
      {showComments && <div style={{ padding: '0 17px 14px' }}><CommentThread postId={item.id} onCountChange={setCommentCount} /></div>}
    </article>
  )
}
