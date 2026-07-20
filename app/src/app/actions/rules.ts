'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { type TradingRules, type TradingSession } from '@/lib/rules'

export type RulesState = { error?: string; ok?: boolean }

const SESSIONS = ['london', 'newyork', 'asia', 'sydney'] as const

function posIntOrNull(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
}
function posNumOrNull(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? n : null
}

export async function saveTradingRules(_prev: RulesState, formData: FormData): Promise<RulesState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const sessionRaw = String(formData.get('session') ?? '').trim()
  const session = (SESSIONS as readonly string[]).includes(sessionRaw) ? (sessionRaw as TradingSession) : null

  const row = {
    user_id: user.id,
    max_trades_per_day: posIntOrNull(formData.get('max_trades_per_day')),
    min_rr: posNumOrNull(formData.get('min_rr')),
    max_risk_percent: posNumOrNull(formData.get('max_risk_percent')),
    require_stop: formData.get('require_stop') === 'on',
    session,
    no_trade_after_losses: posIntOrNull(formData.get('no_trade_after_losses')),
  }

  const { error } = await supabase.from('trading_rules').upsert(row, { onConflict: 'user_id' })
  if (error) return { error: 'Could not save rules.' }
  revalidatePath('/journal')
  revalidatePath('/settings')
  return { ok: true }
}

export async function getTradingRules(): Promise<TradingRules | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('trading_rules').select('*').eq('user_id', user.id).maybeSingle()
  if (!data) return null
  return {
    maxTradesPerDay: data.max_trades_per_day,
    minRr: data.min_rr,
    maxRiskPercent: data.max_risk_percent,
    requireStop: data.require_stop,
    session: data.session,
    noTradeAfterLosses: data.no_trade_after_losses,
  }
}
