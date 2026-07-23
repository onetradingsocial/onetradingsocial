'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { addComment, deleteComment, getComments, type CommentItem } from '@/app/actions/social'
import { UserLink } from '@/app/_components/UserLink'

export function CommentThread({ postId, onCountChange }: { postId: string; onCountChange?: (n: number) => void }) {
  const [comments, setComments] = useState<CommentItem[]>([])
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [pending, start] = useTransition()

  const load = useCallback(async () => {
    const cs = await getComments(postId)
    setComments(cs)
    onCountChange?.(cs.length)
  }, [postId, onCountChange])
  useEffect(() => { load() }, [load])

  function submit() {
    if (!text.trim()) return
    const b = text; setText(''); setError('')
    start(async () => {
      const r = await addComment(postId, b)
      if (r.error) { setError(r.error); setText(b); return }
      await load()
    })
  }
  function remove(id: string) {
    start(async () => { await deleteComment(id); await load() })
  }

  return (
    <div className="ts-comments">
      {comments.map((c) => (
        <div key={c.id} className="ts-comment">
          <UserLink userId={c.author.id} username={c.author.username} displayName={c.author.display_name} avatarUrl={c.author.avatar_url} />
          <p>{c.body}</p>
          {c.isOwn ? <button type="button" className="ts-mini" onClick={() => remove(c.id)}>Delete</button> : <span />}
        </div>
      ))}
      <div className="ts-comment-add">
        <input className="ts-input" placeholder="Write a comment…" value={text}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
        <button type="button" className="btn btn-primary btn-sm" onClick={submit} disabled={pending || !text.trim()}>Reply</button>
      </div>
      {error && <p className="ts-error">{error}</p>}
    </div>
  )
}
