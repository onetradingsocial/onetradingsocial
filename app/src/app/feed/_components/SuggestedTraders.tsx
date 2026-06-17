import { UserLink } from '@/app/_components/UserLink'
import { FollowButton } from '@/app/_components/FollowButton'

type Trader = { id: string; username: string; display_name: string | null; avatar_url: string | null }

export function SuggestedTraders({ traders }: { traders: Trader[] }) {
  if (traders.length === 0) return null
  return (
    <div className="ts-card ts-suggest">
      <h2 className="ts-h2">Suggested traders</h2>
      <div className="ts-suggest-list mt-3">
        {traders.map((t) => (
          <div key={t.id} className="ts-suggest-item">
            <UserLink username={t.username} displayName={t.display_name} avatarUrl={t.avatar_url} />
            <FollowButton targetId={t.id} initialFollowing={false} />
          </div>
        ))}
      </div>
    </div>
  )
}
