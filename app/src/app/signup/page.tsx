import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { SignupForm } from './SignupForm'
import { RedditPixel } from '@/app/_components/RedditPixel'
import { MetaPixel } from '@/app/_components/MetaPixel'

export default async function SignupPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/')

  return (
    <>
      <RedditPixel event="PageVisit" />
      <MetaPixel event="PageView" />
      <SignupForm />
    </>
  )
}
