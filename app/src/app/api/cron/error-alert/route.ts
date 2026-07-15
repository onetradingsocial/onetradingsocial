import { NextRequest, NextResponse } from 'next/server'
import { authorizedCron } from '@/lib/cron'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * Hourly error watchdog (Sprint 1, row 49). Counts error signals from the last
 * hour and raises a system_alert when a threshold trips. Deduped: one open
 * alert per kind per window. Optionally forwards to ALERT_WEBHOOK_URL
 * (Discord/Slack-compatible JSON) so alerts reach the team without polling
 * the admin dashboard.
 */

const RULES: { kind: string; event: string; threshold: number; label: string }[] = [
  { kind: 'client_error', event: 'client_error', threshold: 3, label: 'client errors' },
  { kind: 'import_failed', event: 'import_failed', threshold: 3, label: 'failed MT5 imports' },
  { kind: 'not_found', event: 'not_found', threshold: 20, label: '404 hits' },
]

export async function GET(req: NextRequest) {
  if (!authorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const svc = createServiceClient()
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const raised: string[] = []

  for (const rule of RULES) {
    const { count } = await svc
      .from('analytics_events')
      .select('id', { count: 'exact', head: true })
      .eq('event', rule.event)
      .gte('created_at', since)
    if ((count ?? 0) < rule.threshold) continue

    // Dedupe: skip if an alert of this kind was already raised in the window.
    const { data: existing } = await svc
      .from('system_alerts')
      .select('id')
      .eq('kind', rule.kind)
      .gte('created_at', since)
      .limit(1)
    if (existing && existing.length > 0) continue

    const message = `${count} ${rule.label} in the last hour (threshold ${rule.threshold})`
    await svc.from('system_alerts').insert({ kind: rule.kind, message, count: count ?? 0 })
    raised.push(message)
  }

  // Broker sync health: connected accounts stuck in error state.
  const { count: syncErrors } = await svc
    .from('broker_accounts')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'error')
  if ((syncErrors ?? 0) > 0) {
    const { data: existing } = await svc
      .from('system_alerts')
      .select('id')
      .eq('kind', 'sync_error')
      .eq('acked', false)
      .limit(1)
    if (!existing || existing.length === 0) {
      const message = `${syncErrors} broker connection(s) in error state`
      await svc.from('system_alerts').insert({ kind: 'sync_error', message, count: syncErrors ?? 0 })
      raised.push(message)
    }
  }

  const webhook = process.env.ALERT_WEBHOOK_URL
  if (webhook && raised.length > 0) {
    try {
      await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `⚠️ TradingSocial alerts:\n${raised.join('\n')}`, text: `TradingSocial alerts: ${raised.join('; ')}` }),
      })
    } catch {
      // webhook failure must not fail the cron
    }
  }

  return NextResponse.json({ ok: true, raised })
}
