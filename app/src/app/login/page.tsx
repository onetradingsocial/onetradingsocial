import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LoginForm } from './LoginForm'
import { RedditPixel } from '@/app/_components/RedditPixel'

export default async function LoginPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/')

  return (
    <>
      <RedditPixel event="PageVisit" />
      <LoginForm />
    </>
  )
}
