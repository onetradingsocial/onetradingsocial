import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * Uptime probe (Sprint 2, row 50). Point an external monitor (e.g. UptimeRobot,
 * free tier) at GET /api/health — 200 means app AND database are reachable.
 * Returns no data beyond status, so it's safe to expose.
 */
export async function GET() {
  try {
    const { error } = await createServiceClient()
      .from('feature_flags').select('feature', { head: true, count: 'exact' }).limit(1)
    if (error) return NextResponse.json({ ok: false, db: false }, { status: 503 })
    return NextResponse.json({ ok: true, db: true })
  } catch {
    return NextResponse.json({ ok: false, db: false }, { status: 503 })
  }
}
