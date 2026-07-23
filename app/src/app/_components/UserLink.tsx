import Link from 'next/link'
import { TraderHoverCard } from '@/app/_components/TraderHoverCard'

export function UserLink({ userId, username, displayName, avatarUrl, sub }: {
  userId?: string; username: string; displayName?: string | null; avatarUrl?: string | null; sub?: string
}) {
  const name = displayName || username
  const link = (
    <Link href={`/${username}`} className="ts-userlink">
      {avatarUrl
        ? <img src={avatarUrl} alt="" className="ts-userlink-av" />
        : <span className="ts-userlink-av ts-userlink-ph">{name.charAt(0).toUpperCase()}</span>}
      <span className="ts-userlink-meta">
        <span className="nm">{name}</span>
        <span className="un">@{username}{sub ? ` · ${sub}` : ''}</span>
      </span>
    </Link>
  )
  if (!userId) return link
  return (
    <TraderHoverCard userId={userId} username={username} displayName={displayName ?? null} avatarUrl={avatarUrl ?? null} wrapClassName="thc-inline">
      {link}
    </TraderHoverCard>
  )
}
