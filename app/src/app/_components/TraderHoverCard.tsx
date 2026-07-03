'use client'

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { getTraderCardData, follow, unfollow, favorite, unfavorite, type TraderCardData } from '@/app/actions/social'

// Session-scoped cache so repeat hovers don't refetch.
const cache = new Map<string, TraderCardData>()

const CARD_W = 300
const CARD_H = 172 // estimate for flip decision only

function CardActions({ userId, data, onChange }: { userId: string; data: TraderCardData; onChange: (d: TraderCardData) => void }) {
  const [pending, start] = useTransition()
  const flip = (patch: Partial<TraderCardData>, act: () => Promise<{ error?: string; ok?: boolean }>) => {
    const prev = data
    onChange({ ...data, ...patch })
    start(async () => {
      const r = await act()
      if ('error' in r && r.error) onChange(prev)
    })
  }
  return (
    <div className="thc-actions">
      <button className={'h-followbtn' + (data.viewerFollows ? ' on' : '')} disabled={pending}
        onClick={() => flip({ viewerFollows: !data.viewerFollows },
          () => data.viewerFollows ? unfollow(userId) : follow(userId))}>
        {data.viewerFollows ? 'Following' : 'Follow'}
      </button>
      <button className={'star-btn thc-star' + (data.viewerFavorited ? ' on' : '')} disabled={pending}
        aria-pressed={data.viewerFavorited}
        aria-label={data.viewerFavorited ? 'Remove from favourites' : 'Favourite this trader'}
        onClick={() => flip(
          // Star implies follow, so reflect that optimistically too.
          data.viewerFavorited ? { viewerFavorited: false } : { viewerFavorited: true, viewerFollows: true },
          () => data.viewerFavorited ? unfavorite(userId) : favorite(userId))}>
        <svg viewBox="0 0 24 24" width={15} height={15}>
          <path d="M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9l-5.4 2.9 1.1-6.1L3.2 9.4l6.1-.8L12 3z"
            fill={data.viewerFavorited ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  )
}

export function TraderHoverCard({ userId, username, displayName, avatarUrl, children }:
  { userId: string; username: string; displayName: string | null; avatarUrl: string | null; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [data, setData] = useState<TraderCardData | null>(null)
  const [failed, setFailed] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function place() {
    const r = wrapRef.current?.getBoundingClientRect()
    if (!r) return
    const below = r.bottom + 8 + CARD_H <= window.innerHeight
    setPos({
      top: below ? r.bottom + 8 : Math.max(8, r.top - CARD_H - 8),
      left: Math.min(Math.max(8, r.left), window.innerWidth - CARD_W - 8),
    })
  }

  function show() {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
    place()
    setOpen(true)
    if (!data) {
      const hit = cache.get(userId)
      if (hit) { setData(hit); return }
      getTraderCardData(userId)
        .then((d) => { if (d) { cache.set(userId, d); setData(d) } else setFailed(true) })
        .catch(() => setFailed(true))
    }
  }
  const scheduleShow = () => { if (!openTimer.current) openTimer.current = setTimeout(() => { openTimer.current = null; show() }, 300) }
  const cancelShow = () => { if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null } }
  const scheduleHide = () => { cancelShow(); closeTimer.current = setTimeout(() => setOpen(false), 200) }
  const cancelHide = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null } }

  // Touch: tap on the trigger toggles the card; tap outside closes.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: PointerEvent) => {
      const t = e.target as Node
      if (!wrapRef.current?.contains(t) && !document.getElementById(`thc-${userId}`)?.contains(t)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDoc)
    return () => document.removeEventListener('pointerdown', onDoc)
  }, [open, userId])
  useEffect(() => () => { cancelShow(); cancelHide() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const updateData = (d: TraderCardData) => { cache.set(userId, d); setData(d) }

  return (
    <div ref={wrapRef} className="thc-wrap"
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') scheduleShow() }}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') scheduleHide() }}
      onClick={(e) => {
        // Touch fallback: tap on non-link parts of the trigger opens the card.
        const isTouch = window.matchMedia('(hover: none)').matches
        if (isTouch && !(e.target as HTMLElement).closest('a')) { e.preventDefault(); open ? setOpen(false) : show() }
      }}>
      {children}
      {open && pos && createPortal(
        <div id={`thc-${userId}`} className="thc-card" style={{ top: pos.top, left: pos.left, width: CARD_W }}
          onPointerEnter={cancelHide} onPointerLeave={(e) => { if (e.pointerType === 'mouse') scheduleHide() }}>
          <div className="thc-head">
            <Link href={`/${username}`} className="thc-id">
              {avatarUrl
                ? <img src={avatarUrl} alt="" className="thc-av" />
                : <span className="thc-av thc-av-ph">{(displayName || username).charAt(0).toUpperCase()}</span>}
              <span className="thc-names"><b>{displayName || username}</b><span>@{username}</span></span>
            </Link>
            {data && !data.isSelf && <CardActions userId={userId} data={data} onChange={updateData} />}
          </div>
          {data
            ? <div className="thc-stats">
                <span><b>{Math.round(data.winRate * 100)}%</b> win rate</span>
                <span><b>{data.trades}</b> trades</span>
                <span><b>Lvl {data.level}</b></span>
              </div>
            : !failed && <div className="thc-stats thc-loading">Loading…</div>}
        </div>,
        document.body,
      )}
    </div>
  )
}
