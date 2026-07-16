'use server'

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { validateUsername } from '@/lib/username'
import { trackServer } from '@/lib/server/track'

export type ActionState = { error?: string }

export async function signUp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const username = String(formData.get('username') ?? '')
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')
  const terms = formData.get('terms')

  if (!terms) return { error: 'You must accept the terms and disclaimer.' }
  const v = validateUsername(username)
  if (!v.ok) return { error: v.error }
  if (password.length < 8) return { error: 'Password must be at least 8 characters.' }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username } },
  })
  if (error) return { error: error.message }
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    return { error: 'An account with this email already exists.' }
  }

  if (data.user) {
    // Attribution: the campaign/ref code captured by middleware sticks to the
    // profile at signup (service client: the trigger-created row is ours).
    const ref = (await cookies()).get('ts_ref')?.value ?? null
    if (ref) {
      await createServiceClient().from('profiles')
        .update({ acquisition_source: ref.slice(0, 64) }).eq('id', data.user.id)
    }
    await trackServer('signup_completed', { id: data.user.id, email }, { method: 'email', source: ref })
  }

  redirect('/select-plan')
}

export async function signIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { error: error.message }

  redirect('/')
}
