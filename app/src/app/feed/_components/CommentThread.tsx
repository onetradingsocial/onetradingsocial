'use client'

import { useEffect, useState, useTransition } from 'react'
import { addComment, deleteComment, getComments, type CommentItem } from '@/app/actions/social'
import { UserLink } from '@/app/_components/UserLink'

export function CommentThread({ postId, onCountChange }: { postId: string; onCountChange?: (n: number) => void }) {
  const [comments, setComments] = useState<CommentItem[]>([])
  const [text, setText] = useState('')
  const [pending, start] = useTransition()

  async function load() {
    const cs = await getComments(postId)
    setComments(cs)
    onCountChange?.(cs.length)
  }
  useEffect(() => { load() }, [postId])

  function submit() {
    if (!text.trim()) return
    const b = text; setText('')
    start(async () => { await addComment(postId, b); await load() })
  }
  function remove(id: string) {
    start(async () => { await deleteComment(id); await load() })
  }

  return (
    <div className="ts-comments">
      {comments.map((c) => (
        <div key={c.id} className="ts-comment">
          <UserLink username={c.author.username} displayName={c.author.display_name} avatarUrl={c.author.avatar_url} />
          <p>{c.body}</p>
          {c.isOwn ? <button type="button" className="ts-mini" onClick={() => remove(c.id)}>Delete</button> : <span />}
        </div>
      ))}
      <div className="ts-comment-add">
        <input className="ts-input" placeholder="Write a comment…" value={text}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
        <button type="button" className="btn btn-primary btn-sm" onClick={submit} disabled={pending || !text.trim()}>Reply</button>
      </div>
    </div>
  )
}
