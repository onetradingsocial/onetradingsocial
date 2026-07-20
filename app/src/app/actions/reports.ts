'use server'

import { createClient } from '@/lib/supabase/server'
import { trackServer } from '@/lib/server/track'

export const REPORT_REASONS = [
  ['suspicious_performance', 'Suspicious performance'],
  ['misleading_claims', 'Misleading profile claims'],
  ['impersonation', 'Impersonation'],
  ['manipulated_screenshots', 'Manipulated screenshots'],
  ['spam', 'Spam'],
  ['advice_violation', 'Financial-advice violation'],
] as const

const REASON_KEYS = new Set<string>(REPORT_REASONS.map(([k]) => k))

export type ReportState = { error?: string; ok?: boolean }

export async function submitReport(input: {
  reportedUsername: string
  reason: string
  detail?: string
  tradeId?: string
}): Promise<ReportState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  if (!REASON_KEYS.has(input.reason)) return { error: 'Pick a valid reason.' }

  const { data: target } = await supabase
    .from('profiles').select('id').eq('username', input.reportedUsername).maybeSingle()
  if (!target) return { error: 'User not found.' }
  if (target.id === user.id) return { error: 'You cannot report yourself.' }

  const { error } = await supabase.from('trade_reports').insert({
    reporter_id: user.id,
    reported_user_id: target.id,
    trade_id: input.tradeId ?? null,
    reason: input.reason,
    detail: (input.detail ?? '').slice(0, 1000) || null,
  })
  // 23505 = the partial unique index: an identical open report already exists.
  if (error) {
    if (error.code === '23505') return { error: 'You already have an open report for this.' }
    return { error: 'Could not submit report.' }
  }

  await trackServer('feedback_submitted', user, { type: 'report', reason: input.reason })
  return { ok: true }
}
