'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

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

// GDPR-style data export (Sprint 3, row 53). Returns a JSON string of the
// user's own rows across every table that references them.
export async function exportMyData(): Promise<{ error?: string; json?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const uid = user.id

  const [profile, trades, posts, comments, likes, follows, feedback, rules, subs, completions, brokers] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', uid).maybeSingle(),
    supabase.from('trades').select('*').eq('user_id', uid),
    supabase.from('posts').select('*').eq('author_id', uid),
    supabase.from('comments').select('*').eq('author_id', uid),
    supabase.from('likes').select('*').eq('user_id', uid),
    supabase.from('follows').select('*').or(`follower_id.eq.${uid},following_id.eq.${uid}`),
    supabase.from('feedback').select('*').eq('user_id', uid),
    supabase.from('trading_rules').select('*').eq('user_id', uid),
    supabase.from('subscriptions').select('*').eq('user_id', uid),
    supabase.from('lesson_completions').select('*').eq('user_id', uid),
    supabase.from('broker_accounts').select('id, provider, login, server, status, created_at').eq('user_id', uid),
  ])

  const payload = {
    exportedAt: new Date().toISOString(),
    account: { id: uid, email: user.email },
    profile: profile.data,
    trades: trades.data ?? [],
    posts: posts.data ?? [],
    comments: comments.data ?? [],
    likes: likes.data ?? [],
    follows: follows.data ?? [],
    feedback: feedback.data ?? [],
    tradingRules: rules.data ?? [],
    subscriptions: subs.data ?? [],
    lessonCompletions: completions.data ?? [],
    brokerAccounts: brokers.data ?? [],
  }
  return { json: JSON.stringify(payload, null, 2) }
}

// Permanent account deletion. Requires the user to type their exact username.
export async function deleteMyAccount(confirmation: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const { data: profile } = await supabase.from('profiles').select('username').eq('id', user.id).maybeSingle()
  if (!profile) return { error: 'Profile not found.' }
  if (confirmation.trim() !== profile.username) return { error: 'Confirmation does not match your username.' }

  // Deleting the auth user cascades to profiles and every user-scoped table
  // (all FKs are ON DELETE CASCADE). Service role required for admin.deleteUser.
  const svc = createServiceClient()
  const { error } = await svc.auth.admin.deleteUser(user.id)
  if (error) return { error: 'Deletion failed. Contact support.' }

  await supabase.auth.signOut()
  redirect('/login?deleted=1')
}
