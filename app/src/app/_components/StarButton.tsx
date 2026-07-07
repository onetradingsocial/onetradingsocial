'use client'

import { useState, useTransition } from 'react'
import { favorite, unfavorite } from '@/app/actions/social'

export function StarButton({ targetId, initialFavorited, canFavorite = true }:
  { targetId: string; initialFavorited: boolean; canFavorite?: boolean }) {
  const [starred, setStarred] = useState(initialFavorited)
  const [pending, start] = useTransition()
  function toggle() {
    const next = !starred
    setStarred(next)
    start(async () => {
      const r = next ? await favorite(targetId) : await unfavorite(targetId)
      if ('error' in r && r.error) setStarred(!next)
    })
  }
  if (!canFavorite) {
    return (
      <a href="/settings/billing" className="star-btn locked" title="Favourite traders — Trader plan and above"
        aria-label="Favourite traders — Trader plan and above">
        🔒
      </a>
    )
  }
  return (
    <button type="button" className={'star-btn' + (starred ? ' on' : '')} onClick={toggle} disabled={pending}
      title={starred ? 'Remove from favourites' : 'Favourite this trader'}
      aria-label={starred ? 'Remove from favourites' : 'Favourite this trader'} aria-pressed={starred}>
      <svg viewBox="0 0 24 24" width={17} height={17}>
        <path d="M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9l-5.4 2.9 1.1-6.1L3.2 9.4l6.1-.8L12 3z"
          fill={starred ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" />
      </svg>
    </button>
  )
}
