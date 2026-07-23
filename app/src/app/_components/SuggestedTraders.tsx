import Link from 'next/link'
import { FollowButton } from './FollowButton'
import { VerificationBadge } from './VerificationBadge'
import { TraderHoverCard } from '@/app/_components/TraderHoverCard'
import type { Recommendation } from '@/lib/recommend'

/**
 * Personalised trader recommendations (row 35). Each row explains *why* it was
 * suggested, so the feed doesn't feel like a black box.
 */
export function SuggestedTraders({ recs }: { recs: Recommendation[] }) {
  if (recs.length === 0) return null
  return (
    <div className="ts-card ts-railcard">
      <div className="ts-rail-head">
        <h2 className="ts-h2">Suggested for you</h2>
        <Link href="/leaderboard" className="ts-link-sm">More</Link>
      </div>
      <div className="mt-3" style={{ display: 'grid', gap: 12 }}>
        {recs.map((r) => (
          <div key={r.userId} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <TraderHoverCard userId={r.userId} username={r.username} displayName={r.displayName} avatarUrl={r.avatarUrl} wrapClassName="thc-inline">
              <Link href={`/${r.username}`} style={{ flexShrink: 0 }}>
                <span className="h-av" style={{
                  width: 36, height: 36, display: 'block',
                  ...(r.avatarUrl ? { backgroundImage: `url(${r.avatarUrl})`, backgroundSize: 'cover' } : {}),
                }} />
              </Link>
              <div style={{ minWidth: 0 }}>
                <Link href={`/${r.username}`} style={{ fontWeight: 600, fontSize: 13.5, textDecoration: 'none' }}>
                  {r.displayName || r.username}
                </Link>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <VerificationBadge level={r.verification} short linked={false} />
                </div>
                <div className="faint" style={{ fontSize: 11.5, marginTop: 2 }}>{r.reasons.join(' · ')}</div>
              </div>
            </TraderHoverCard>
            <FollowButton targetId={r.userId} initialFollowing={false} />
          </div>
        ))}
      </div>
    </div>
  )
}
