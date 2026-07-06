import { NextResponse } from 'next/server'
import { authorizedCron } from '@/lib/cron'
import { createServiceClient } from '@/lib/supabase/service'
import { deployAccount } from '@/lib/server/metaapi'

export const maxDuration = 60

export async function GET(req: Request) {
  if (!authorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const svc = createServiceClient()
  const { data: rows, error } = await svc
    .from('broker_accounts')
    .select('id, metaapi_account_id')
    .in('status', ['pending', 'active', 'error'])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let deployed = 0
  for (const row of rows ?? []) {
    const r = await deployAccount(row.metaapi_account_id)
    if ('error' in r) {
      await svc.from('broker_accounts').update({ sync_error: `deploy: ${r.error}` }).eq('id', row.id)
    } else {
      deployed++
    }
  }
  return NextResponse.json({ deployed, total: rows?.length ?? 0 })
}
