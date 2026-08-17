import './globals.css'
import type { Metadata } from 'next'
import { Space_Grotesk, Manrope, JetBrains_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { AppNav } from './_components/AppNav'
import { TradeModalProvider } from './_components/TradeModalProvider'
import { HelpWidget } from './_components/HelpWidget'
import { GoogleAnalytics } from './_components/GoogleAnalytics'
import { PageViewTracker } from './_components/PageViewTracker'
import { createClient, getSessionUser } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { isAdmin } from '@/lib/server/admin'
import { getEntitlements, type TrialGate, type WelcomeState } from '@/lib/server/entitlements'
import type { Tier } from '@/lib/entitlements'
import { getFeatureFlags } from '@/lib/server/feature-flags'
import { canFlag } from '@/lib/feature-flags'
import { TrialGateModal } from './_components/TrialGateModal'
import { TrialEndingBanner } from './_components/TrialEndingBanner'
import { WelcomeModal } from './_components/WelcomeModal'

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-display' })
const body = Manrope({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-body' })
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['500', '600'], variable: '--font-mono' })

export const metadata: Metadata = {
  title: 'TradingSocial',
  description: 'Track. Prove. Improve your trading.',
  icons: { icon: '/favicon.png' },
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const user = await getSessionUser(supabase)
  let config: { accountBalance: number; defaultPublic: boolean; canMt5Import: boolean; canAdvancedJournal: boolean; maxStrategyTags: number; canPrivateNotes: boolean; canTemplates: boolean } | null = null
  let internalTraffic = false
  let gate: TrialGate | null = null
  let tier: Tier | null = null
  let welcome: WelcomeState | null = null
  let username: string | null = null
  if (user) {
    // One pass for tier + gate: they read the same two rows, so asking for them
    // separately cost two extra serialized profiles round trips per render.
    // Service client: 0047 revokes SELECT on account_balance and is_internal
    // from both client roles. Column grants are role-wide and cannot be
    // conditioned on row ownership, so the owner's own read of its own private
    // fields has to come from a path that holds the privilege. Filtered by
    // user.id from getSessionUser(), so it still reads exactly one row -- the
    // caller's -- and never widens what the page can see.
    const [{ data }, ent, flags] = await Promise.all([
      createServiceClient()
        .from('profiles').select('account_balance, is_public, is_internal, username')
        .eq('id', user.id).single(),
      getEntitlements(supabase, user.id),
      getFeatureFlags(),
    ])
    tier = ent.tier
    gate = ent.gate
    welcome = ent.welcome
    username = data?.username ?? null
    internalTraffic = isAdmin(user) || (data?.is_internal ?? false)
    config = {
      accountBalance: data?.account_balance ?? 0,
      defaultPublic: data?.is_public ?? true,
      canMt5Import: canFlag(flags, ent.tier, 'mt5_import'),
      canAdvancedJournal: canFlag(flags, ent.tier, 'advanced_journal'),
      // Strategy tracking: Trader tags one strategy per trade, Pro is multi-strategy.
      maxStrategyTags: canFlag(flags, ent.tier, 'strategy_tracking') ? (ent.tier === 'pro' ? 8 : 1) : 0,
      canPrivateNotes: canFlag(flags, ent.tier, 'private_notes'),
      canTemplates: canFlag(flags, ent.tier, 'custom_templates'),
    }
  }

  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <TradeModalProvider config={config}>
          <AppNav tier={tier} gate={gate} />
          {gate?.state === 'active' && gate.daysLeft <= 3 && (
            <TrialEndingBanner daysLeft={gate.daysLeft} />
          )}
          {children}
          {user && <HelpWidget />}
          {user && <TrialGateModal show={!!gate?.showWall} />}
          {user && welcome?.show && (
            <WelcomeModal
              tier={welcome.tier}
              username={username}
              trialActive={gate?.state === 'active'}
            />
          )}
        </TradeModalProvider>
        <Analytics />
        <GoogleAnalytics isInternal={internalTraffic} />
        <PageViewTracker />
      </body>
    </html>
  )
}
