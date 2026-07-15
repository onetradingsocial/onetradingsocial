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
import { isAdmin } from '@/lib/server/admin'
import { getTier } from '@/lib/server/entitlements'
import { getFeatureFlags } from '@/lib/server/feature-flags'
import { canFlag } from '@/lib/feature-flags'

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
  if (user) {
    const [{ data }, tier, flags] = await Promise.all([
      supabase.from('profiles').select('account_balance, is_public, is_internal').eq('id', user.id).single(),
      getTier(supabase, user.id),
      getFeatureFlags(),
    ])
    internalTraffic = isAdmin(user) || (data?.is_internal ?? false)
    config = {
      accountBalance: data?.account_balance ?? 0,
      defaultPublic: data?.is_public ?? true,
      canMt5Import: canFlag(flags, tier, 'mt5_import'),
      canAdvancedJournal: canFlag(flags, tier, 'advanced_journal'),
      // Strategy tracking: Trader tags one strategy per trade, Pro is multi-strategy.
      maxStrategyTags: canFlag(flags, tier, 'strategy_tracking') ? (tier === 'pro' ? 8 : 1) : 0,
      canPrivateNotes: canFlag(flags, tier, 'private_notes'),
      canTemplates: canFlag(flags, tier, 'custom_templates'),
    }
  }

  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <TradeModalProvider config={config}>
          <AppNav />
          {children}
          {user && <HelpWidget />}
        </TradeModalProvider>
        <Analytics />
        <GoogleAnalytics isInternal={internalTraffic} />
        <PageViewTracker />
      </body>
    </html>
  )
}
