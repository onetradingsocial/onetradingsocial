'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { validateUsername } from '@/lib/username'

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

  redirect('/onboarding')
}

export async function signIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { error: error.message }

  redirect('/')
}
