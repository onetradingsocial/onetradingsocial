import 'server-only'
import { rollupFills, type Fill } from '@/lib/crypto/fills'
import { mapCycleToTrade } from '@/lib/crypto/map'

// Pure core: fills -> journal rows + the new cursor. No DB, no network, so it
// is fully unit-testable. The cursor is the max fill timestamp seen (even when
// no cycle closed), so an open position is never re-fetched from scratch.
export function planImport(
  fills: Fill[],
  opts: { userId: string; isPublic: boolean; exchange: string },
): { rows: Record<string, unknown>[]; cursor: number | null; warnings: string[] } {
  const { cycles, warnings } = rollupFills(fills)
  const rows = cycles.map((c) => mapCycleToTrade(c, opts))
  const cursor = fills.length ? Math.max(...fills.map((f) => f.timestamp)) : null
  return { rows, cursor, warnings }
}

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchFillsSince as realFetch, type ExchangeCreds } from '@/lib/server/binance'
import { decryptSecret as realDecrypt } from '@/lib/server/secrets'
import { insertSystemNotification as realNotify } from '@/lib/notifications'

export type ExchangeRow = {
  id: string; user_id: string; exchange: string
  api_key_enc: string; api_secret_enc: string
  symbols: string[]; last_fill_at: string | null
}

export type SyncDeps = {
  fetchFillsSince: (creds: ExchangeCreds, symbol: string, sinceMs: number | null) => Promise<Fill[]>
  decryptSecret: (enc: string) => Promise<string>
  insertSystemNotification: typeof realNotify
}

const defaultDeps: SyncDeps = {
  fetchFillsSince: (creds, symbol, since) => realFetch(creds, symbol, since),
  decryptSecret: realDecrypt,
  insertSystemNotification: realNotify,
}

export async function syncExchangeAccount(
  svc: SupabaseClient,
  row: ExchangeRow,
  overrides: Partial<SyncDeps> = {},
): Promise<{ imported: number } | { error: string }> {
  const deps = { ...defaultDeps, ...overrides }
  try {
    const creds: ExchangeCreds = {
      apiKey: await deps.decryptSecret(row.api_key_enc),
      apiSecret: await deps.decryptSecret(row.api_secret_enc),
    }
    const sinceMs = row.last_fill_at ? Date.parse(row.last_fill_at) : null

    const all: Fill[] = []
    for (const symbol of row.symbols) {
      const fills = await deps.fetchFillsSince(creds, symbol, sinceMs)
      all.push(...fills)
    }

    const { data: profile } = await svc
      .from('profiles').select('is_public').eq('id', row.user_id).single()
    const { rows, cursor } = planImport(all, {
      userId: row.user_id, isPublic: profile?.is_public ?? true, exchange: row.exchange,
    })

    let imported = 0
    if (rows.length > 0) {
      const { data, error } = await svc
        .from('trades')
        .upsert(rows, { onConflict: 'user_id,broker_deal_id', ignoreDuplicates: true })
        .select('id')
      if (error) throw new Error(error.message)
      imported = data?.length ?? 0
    }

    await svc.from('exchange_accounts').update({
      status: 'active',
      sync_error: null,
      last_sync_at: new Date().toISOString(),
      ...(cursor != null ? { last_fill_at: new Date(cursor).toISOString() } : {}),
    }).eq('id', row.id)

    if (imported > 0) {
      await deps.insertSystemNotification({ supabase: svc, userId: row.user_id, type: 'import_done' })
    }
    return { imported }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'sync failed'
    await svc.from('exchange_accounts').update({ status: 'error', sync_error: msg }).eq('id', row.id)
    await deps.insertSystemNotification({ supabase: svc, userId: row.user_id, type: 'sync_failed' })
    return { error: msg }
  }
}
