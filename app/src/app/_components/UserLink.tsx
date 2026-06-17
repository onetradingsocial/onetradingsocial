import Link from 'next/link'

export function UserLink({ username, displayName, avatarUrl, sub }: {
  username: string; displayName?: string | null; avatarUrl?: string | null; sub?: string
}) {
  const name = displayName || username
  return (
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
}
