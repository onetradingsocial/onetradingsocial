'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getTier } from '@/lib/server/entitlements'
import { getFeatureFlags } from '@/lib/server/feature-flags'
import { canFlag } from '@/lib/feature-flags'
import { requiredPlanLabel } from '@/lib/entitlements'
import { type TradingRules, type TradingSession } from '@/lib/rules'
import { allowAction, JOURNAL_BUDGET } from '@/lib/server/action-throttle'

export type RulesState = { error?: string; ok?: boolean }

const SESSIONS = ['london', 'newyork', 'asia', 'sydney'] as const

/** Named from the same map the gate below reads, so the plan the copy promises
 *  cannot drift from the plan the check enforces — see requiredPlanLabel.
 *
 *  Module-private on purpose. A 'use server' module may only export async
 *  functions; Next rejects the build on any other export, so this string cannot
 *  leave the file. tests/unit/rules-gate.test.ts rebuilds it from the same
 *  requiredPlanLabel call rather than importing it. */
const RULES_GATE_ERROR =
  `Trading rules are available on the ${requiredPlanLabel('trading_rules')} plan and above.`

/** Not named `gate`: every action in this codebase already binds that name to
 *  the throttle result (`const gate = await allowAction(...)`), and a const in
 *  the function body shadows a module function across the whole body — the call
 *  would hit the temporal dead zone and throw instead of checking the tier. */
async function requireRulesTier(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const tier = await getTier(supabase, userId)
  const flags = await getFeatureFlags()
  return canFlag(flags, tier, 'trading_rules') ? null : RULES_GATE_ERROR
}

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
  const gate = await allowAction(JOURNAL_BUDGET, user.id)
  if (!gate.ok) return { error: gate.message }

  // The UI only renders this form behind canFlag(..., 'trading_rules'), but a
  // hand-built POST reaches the action regardless: this was the one gated write
  // in the codebase with no server-side re-check.
  const denied = await requireRulesTier(supabase, user.id)
  if (denied) return { error: denied }

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

/** Deliberately NOT tier-gated, unlike the write above.
 *
 *  It returns the caller's own row and nothing else, so there is no paid
 *  capability behind it to buy — the paid part is the compliance analysis the
 *  journal computes, which stays behind canRules at journal/page.tsx:101. A
 *  gate here would only fail closed on a downgrade and hide a Trader's own
 *  saved rules from them, which is the reverse of what we want: their data
 *  should survive a lapse so that resubscribing restores it. Two other paths
 *  already read the same row with no tier check for exactly that reason — the
 *  GDPR export (actions/account.ts) and the rule-breach notification on close
 *  (actions/trade.ts). Gating this one would close no hole and break that. */
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
