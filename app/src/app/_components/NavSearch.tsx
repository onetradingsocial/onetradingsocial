'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { search } from '@/app/actions/search'
import type { SearchResults } from '@/lib/search'

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function excerpt(body: string, n = 60): string {
  return body.length > n ? body.slice(0, n).trimEnd() + '…' : body
}

const EMPTY: SearchResults = { users: [], posts: [] }

export function NavSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResults>(EMPTY)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // debounce: run search 250ms after typing stops
  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults(EMPTY)
      setOpen(false)
      setLoading(false)
      return
    }
    setLoading(true)
    setOpen(true)
    let cancelled = false
    const t = setTimeout(async () => {
      const r = await search(trimmed)
      if (cancelled) return
      setResults(r)
      setLoading(false)
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query])

  // close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    if (open) document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open])

  const hasResults = results.users.length > 0 || results.posts.length > 0

  return (
    <div ref={ref} className="ts-search">
      <label className="ts-nav-search">
        <span aria-hidden>⌕</span>
        <input
          placeholder="Search traders, setups, markets…"
          aria-label="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { if (query.trim().length >= 2) setOpen(true) }}
        />
      </label>

      {open && (
        <div className="ts-search-dropdown" role="dialog" aria-label="Search results">
          {loading ? (
            <p className="ts-search-empty">Searching…</p>
          ) : !hasResults ? (
            <p className="ts-search-empty">No results for "{query.trim()}"</p>
          ) : (
            <>
              {results.users.length > 0 && (
                <div className="ts-search-section">
                  <p className="ts-search-head">Traders</p>
                  <ul className="ts-search-list">
                    {results.users.map((u) => (
                      <li key={u.username}>
                        <Link href={`/${u.username}`} className="ts-search-row" onClick={() => setOpen(false)}>
                          <span className="ts-search-avatar">
                            {u.avatarUrl
                              ? <img src={u.avatarUrl} alt="" width={28} height={28} style={{ borderRadius: '50%' }} />
                              : <span className="ts-search-avatar-initial">{(u.username[0] ?? '?').toUpperCase()}</span>}
                          </span>
                          <span className="ts-search-body">
                            <span className="ts-search-name">{u.displayName ?? u.username}</span>
                            <span className="ts-search-sub">@{u.username}</span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {results.posts.length > 0 && (
                <div className="ts-search-section">
                  <p className="ts-search-head">Posts</p>
                  <ul className="ts-search-list">
                    {results.posts.map((p) => (
                      <li key={p.id}>
                        <Link href={`/#post-${p.id}`} className="ts-search-row" onClick={() => setOpen(false)}>
                          <span className="ts-search-avatar">
                            {p.author.avatarUrl
                              ? <img src={p.author.avatarUrl} alt="" width={28} height={28} style={{ borderRadius: '50%' }} />
                              : <span className="ts-search-avatar-initial">{(p.author.username[0] ?? '?').toUpperCase()}</span>}
                          </span>
                          <span className="ts-search-body">
                            <span className="ts-search-text">{excerpt(p.body)}</span>
                            <span className="ts-search-sub">@{p.author.username} · {relativeTime(p.createdAt)}</span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
