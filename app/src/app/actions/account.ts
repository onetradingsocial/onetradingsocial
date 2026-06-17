'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type AccountState = { error?: string; ok?: boolean }

export async function saveAccount(_prev: AccountState, formData: FormData): Promise<AccountState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const balance = Number(formData.get('account_balance') ?? 0)
  const currency = String(formData.get('account_currency') ?? 'USD').trim().toUpperCase().slice(0, 3)
  if (!Number.isFinite(balance) || balance < 0) return { error: 'Enter a valid balance.' }

  const { error } = await supabase
    .from('profiles')
    .update({ account_balance: balance, account_currency: currency || 'USD' })
    .eq('id', user.id)
  if (error) return { error: error.message }
  revalidatePath('/settings')
  return { ok: true }
}
