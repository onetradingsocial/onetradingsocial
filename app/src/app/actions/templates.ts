'use server'

import { createClient } from '@/lib/supabase/server'
import { getTier } from '@/lib/server/entitlements'
import { getFeatureFlags } from '@/lib/server/feature-flags'
import { canFlag } from '@/lib/feature-flags'

export type TradeTemplate = {
  id: string
  name: string
  payload: TemplatePayload
}

export type TemplatePayload = {
  market?: string
  instrument?: string
  direction?: string
  sizing_mode?: string
  risk_percent?: string
  lots?: string
  setup_type?: string
  strategy_tags?: string[]
}

const MAX_TEMPLATES = 12

async function requireTemplates() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' as const }
  const tier = await getTier(supabase, user.id)
  if (!canFlag(await getFeatureFlags(), tier, 'custom_templates')) {
    return { error: 'Custom templates are a Pro perk.' as const }
  }
  return { supabase, user }
}

export async function listTradeTemplates(): Promise<{ templates?: TradeTemplate[]; error?: string }> {
  const ctx = await requireTemplates()
  if ('error' in ctx) return { error: ctx.error }
  const { data, error } = await ctx.supabase
    .from('trade_templates')
    .select('id, name, payload')
    .order('created_at', { ascending: false })
    .limit(MAX_TEMPLATES)
  if (error) return { error: error.message }
  return { templates: (data ?? []) as TradeTemplate[] }
}

export async function saveTradeTemplate(name: string, payload: TemplatePayload): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await requireTemplates()
  if ('error' in ctx) return { error: ctx.error }
  const clean = name.trim().slice(0, 40)
  if (!clean) return { error: 'Template needs a name.' }
  const { count } = await ctx.supabase
    .from('trade_templates').select('*', { count: 'exact', head: true }).eq('user_id', ctx.user.id)
  if ((count ?? 0) >= MAX_TEMPLATES) return { error: `Template limit reached (${MAX_TEMPLATES}). Delete one first.` }
  // Whitelist payload keys so arbitrary JSON can't be stored.
  const safe: TemplatePayload = {
    market: payload.market, instrument: payload.instrument, direction: payload.direction,
    sizing_mode: payload.sizing_mode, risk_percent: payload.risk_percent, lots: payload.lots,
    setup_type: payload.setup_type, strategy_tags: (payload.strategy_tags ?? []).slice(0, 8),
  }
  const { error } = await ctx.supabase
    .from('trade_templates').insert({ user_id: ctx.user.id, name: clean, payload: safe })
  if (error) return { error: error.message }
  return { ok: true }
}

export async function deleteTradeTemplate(id: string): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await requireTemplates()
  if ('error' in ctx) return { error: ctx.error }
  const { error } = await ctx.supabase
    .from('trade_templates').delete().eq('id', id).eq('user_id', ctx.user.id)
  if (error) return { error: error.message }
  return { ok: true }
}
