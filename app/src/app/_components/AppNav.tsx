/* eslint-disable @next/next/no-img-element --
 * User-supplied images (Supabase storage, Google avatars) whose display size
 * comes entirely from CSS — percentages, a dynamic size prop, or viewport
 * units. next/image needs fixed dimensions or fill plus a positioned wrapper,
 * so converting is a layout change, and it routes every avatar through the
 * metered Vercel optimiser. Revisit if these ever show up as an LCP problem.
 */

import Link from 'next/link'
import { createClient, getSessionUser } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/server/admin'
import type { TrialGate } from '@/lib/server/entitlements'
import type { Tier } from '@/lib/entitlements'
import { canFlag } from '@/lib/feature-flags'
import { getFeatureFlags } from '@/lib/server/feature-flags'
import { Brand } from './Brand'
import { NewTradeButton } from './NewTradeButton'
import { NavLinks } from './NavLinks'
import { MobileNav } from './MobileNav'
import { createServiceClient } from '@/lib/supabase/service'
import { getNotifications, getUnreadCount, type Notification } from '@/lib/server/notifications'
import { getUnreadTotal } from '@/lib/server/messaging'
import { NotificationBell } from './NotificationBell'
import { MessagesBell } from './MessagesBell'
import { NavSearch } from './NavSearch'
import { ReferralLauncher } from './ReferralLauncher'
import { TrialChip } from './TrialChip'

/** `tier` and `gate` come from the root layout, which already resolved them for
 *  this request. Computing them here as well doubled the entitlement round
 *  trips on every authenticated render. Both are null for logged-out visitors. */
export async function AppNav({ tier, gate }: { tier: Tier | null; gate: TrialGate | null }) {
  const supabase = await createClient()
  const user = await getSessionUser(supabase)

  let profile: { username: string; avatar_url: string | null } | null = null
  let isPro = false
  const onTrial = gate?.state === 'active'
  const trialDaysLeft = gate?.daysLeft ?? 0
  let initialNotifCount = 0
  let initialNotifItems: Notification[] = []
  let initialMsgUnread = 0
  if (user) {
    const { data } = await supabase.from('profiles').select('username, avatar_url').eq('id', user.id).single()
    profile = data
    isPro = canFlag(await getFeatureFlags(), tier ?? 'free', 'pro_badge')
    const service = createServiceClient()
    ;[initialNotifCount, initialNotifItems, initialMsgUnread] = await Promise.all([
      getUnreadCount(service, user.id),
      getNotifications(service, user.id),
      getUnreadTotal(service, user.id),
    ])
  }

  return (
    <nav className="ts-nav">
      <div className="ts-nav-inner">
        <Link href="/" aria-label="TradingSocial home" className="ts-nav-brand"><Brand /></Link>

        {user ? (
          <>
            <NavLinks />
            <NavSearch />
            <div className="ts-nav-right">
              <NotificationBell initialCount={initialNotifCount} initialItems={initialNotifItems} />
              <MessagesBell initialCount={initialMsgUnread} />
              <ReferralLauncher />
              <NewTradeButton className="btn btn-primary btn-sm" />
              {onTrial
                ? <TrialChip daysLeft={trialDaysLeft} />
                : isPro
                  ? <span className="ts-pro-badge">PRO</span>
                  : <Link href="/settings/billing" className="btn btn-sm" style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px' }}>Upgrade</Link>}
              {isAdmin(user) && (
                <Link href="/admin" className="ts-nav-icon" title="Admin" aria-label="Admin">🛡</Link>
              )}
              <Link href="/settings" className="ts-nav-icon" title="Settings" aria-label="Settings">⚙</Link>
              <MobileNav
                isAdmin={isAdmin(user)}
                isPro={isPro}
                onTrial={onTrial}
                trialDaysLeft={trialDaysLeft}
              />
              {profile?.username && (
                <Link href={`/${profile.username}`} className="ts-nav-avatar" aria-label="Your profile">
                  {profile.avatar_url
                    ? <img src={profile.avatar_url} alt="" />
                    : <span>{profile.username.charAt(0).toUpperCase()}</span>}
                </Link>
              )}
            </div>
          </>
        ) : (
          <div className="ts-nav-links">
            <Link className="ts-nav-link" href="/login">Log in</Link>
            <Link className="btn btn-primary btn-sm" href="/signup">Join the Beta</Link>
          </div>
        )}
      </div>
    </nav>
  )
}
