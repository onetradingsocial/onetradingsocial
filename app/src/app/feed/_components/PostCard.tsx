'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { UserLink } from '@/app/_components/UserLink'
import { LikeButton } from './LikeButton'
import { CommentThread } from './CommentThread'
import { deletePost } from '@/app/actions/social'
import { timeAgo } from '@/lib/time'
import { TradeAttachment, type TradeCard } from './attachments/TradeAttachment'
import { ImageGallery } from './attachments/ImageGallery'
import { PollAttachment } from './attachments/PollAttachment'

export type Attachment =
  | { type: 'none' }
  | { type: 'trade'; trade: TradeCard }
  | { type: 'images'; images: string[] }
  | { type: 'poll'; options: { id: string; label: string }[]; votes: { option_id: string }[]; myVote: string | null }

export type FeedItem = {
  id: string; body: string; created_at: string
  author: { id: string; username: string; display_name: string | null; avatar_url: string | null }
  likeCount: number; commentCount: number; viewerLiked: boolean; isOwn: boolean
  attachment: Attachment
}

export function PostCard({ post }: { post: FeedItem }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [commentCount, setCommentCount] = useState(post.commentCount)
  const [, start] = useTransition()

  return (
    <article className="ts-post">
      <div className="ts-post-head">
        <UserLink username={post.author.username} displayName={post.author.display_name} avatarUrl={post.author.avatar_url} sub={timeAgo(post.created_at)} />
        {post.isOwn && <button type="button" className="ts-mini" onClick={() => start(async () => { await deletePost(post.id); router.refresh() })}>Delete</button>}
      </div>
      {post.body.trim() && <p className="ts-post-body">{post.body}</p>}
      {post.attachment.type === 'trade' && <TradeAttachment t={post.attachment.trade} />}
      {post.attachment.type === 'images' && <ImageGallery urls={post.attachment.images} />}
      {post.attachment.type === 'poll' && <PollAttachment postId={post.id} options={post.attachment.options} votes={post.attachment.votes} myVote={post.attachment.myVote} />}
      <div className="ts-post-acts">
        <LikeButton postId={post.id} initialLiked={post.viewerLiked} initialCount={post.likeCount} />
        <button type="button" className="ts-act" onClick={() => setOpen((o) => !o)}>💬 {commentCount}</button>
        <button type="button" className="ts-act" title="Share — coming soon" disabled>↗ Share</button>
        <button type="button" className="ts-act ts-act--right" title="Copy to journal — coming soon" disabled>🔖 Copy to journal</button>
      </div>
      {open && <CommentThread postId={post.id} onCountChange={setCommentCount} />}
    </article>
  )
}
