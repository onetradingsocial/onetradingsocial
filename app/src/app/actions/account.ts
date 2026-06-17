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

  // Backfill: risk%-sized trades derive their risk amount (and money P/L) from the
  // account balance. Changing the balance recomputes them so historical P/L isn't stuck at $0.
  const { data: trades } = await supabase
    .from('trades')
    .select('id, risk_percent, r_multiple, status')
    .eq('user_id', user.id)
    .eq('sizing_mode', 'risk_percent')

  for (const t of trades ?? []) {
    const riskAmount = balance * ((t.risk_percent ?? 0) / 100)
    const update: { risk_amount: number; pnl_amount?: number } = { risk_amount: riskAmount }
    if (t.status === 'closed' && t.r_multiple != null) update.pnl_amount = t.r_multiple * riskAmount
    await supabase.from('trades').update(update).eq('id', t.id)
  }

  revalidatePath('/settings')
  revalidatePath('/journal')
}
