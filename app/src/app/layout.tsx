import './globals.css'
import type { Metadata } from 'next'
import { Space_Grotesk, Manrope, JetBrains_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { AppNav } from './_components/AppNav'
import { TradeModalProvider } from './_components/TradeModalProvider'
import { HelpWidget } from './_components/HelpWidget'
import { createClient, getSessionUser } from '@/lib/supabase/server'

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
  let config: { accountBalance: number; defaultPublic: boolean } | null = null
  if (user) {
    const { data } = await supabase
      .from('profiles').select('account_balance, is_public').eq('id', user.id).single()
    config = { accountBalance: data?.account_balance ?? 0, defaultPublic: data?.is_public ?? true }
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
      </body>
    </html>
  )
}
