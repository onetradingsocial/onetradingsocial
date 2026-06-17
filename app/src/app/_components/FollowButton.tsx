'use client'

import { useState, useTransition } from 'react'
import { follow, unfollow } from '@/app/actions/social'

export function FollowButton({ targetId, initialFollowing }: { targetId: string; initialFollowing: boolean }) {
  const [following, setFollowing] = useState(initialFollowing)
  const [pending, start] = useTransition()
  function toggle() {
    const next = !following
    setFollowing(next)
    start(async () => {
      const r = next ? await follow(targetId) : await unfollow(targetId)
      if ('error' in r && r.error) setFollowing(!next)
    })
  }
  return (
    <button type="button" className={following ? 'btn btn-ghost btn-sm' : 'btn btn-primary btn-sm'} onClick={toggle} disabled={pending}>
      {following ? 'Following' : 'Follow'}
    </button>
  )
}
