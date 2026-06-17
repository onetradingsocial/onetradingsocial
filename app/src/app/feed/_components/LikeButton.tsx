'use client'

import { useState, useTransition } from 'react'
import { toggleLike } from '@/app/actions/social'

export function LikeButton({ postId, initialLiked, initialCount }: { postId: string; initialLiked: boolean; initialCount: number }) {
  const [liked, setLiked] = useState(initialLiked)
  const [count, setCount] = useState(initialCount)
  const [pending, start] = useTransition()

  function toggle() {
    const next = !liked
    setLiked(next); setCount((c) => c + (next ? 1 : -1))
    start(async () => {
      const r = await toggleLike(postId)
      if ('liked' in r) { setLiked(r.liked); setCount(r.count) }
      else { setLiked(!next); setCount((c) => c + (next ? -1 : 1)) }
    })
  }

  return (
    <button type="button" className={`ts-act ${liked ? 'ts-act--on' : ''}`} onClick={toggle} disabled={pending}>
      {liked ? '♥' : '♡'} {count}
    </button>
  )
}
