'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

// Used directly as a <form action> from the (server-component) settings page,
// so it takes FormData only and returns void.
export async function saveAccount(formData: FormData): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const balanceRaw = Number(formData.get('account_balance') ?? 0)
  const balance = Number.isFinite(balanceRaw) && balanceRaw >= 0 ? balanceRaw : 0
  const currency = String(formData.get('account_currency') ?? 'USD').trim().toUpperCase().slice(0, 3) || 'USD'

  await supabase
    .from('profiles')
    .update({ account_balance: balance, account_currency: currency })
    .eq('id', user.id)
  revalidatePath('/settings')
}
