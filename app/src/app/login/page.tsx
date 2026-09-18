import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { LoginForm } from './LoginForm'
import { RedditPixel } from '@/app/_components/RedditPixel'
import { MetaPixel } from '@/app/_components/MetaPixel'

// Auth page: never indexed, but its links may be followed.
// SEO audit 2026-09-18, finding 3.
export const metadata: Metadata = {
  title: 'Log in — TradingSocial',
  robots: { index: false, follow: true },
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/')

  const { deleted } = await searchParams

  return (
    <>
      <RedditPixel event="PageVisit" />
      <MetaPixel event="PageView" />
      <LoginForm deleted={deleted === '1'} />
    </>
  )
}
