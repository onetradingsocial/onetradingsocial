import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * Public proof stats (Sprint 3, row 42) — REAL aggregate counts for the
 * marketing site. Internal/seed accounts excluded so numbers aren't inflated.
 * CORS-open (GET only, no PII) so tradingsocial.io can fetch it cross-origin.
 * Cached briefly to shield the DB from marketing traffic.
 */
export const revalidate = 300 // 5 min ISR-style cache

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'public, max-age=300, s-maxage=300',
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function GET() {
  try {
    const svc = createServiceClient()

    // Every figure here is public-facing proof, so it must count GENUINE users
    // only — no seeded demo accounts, no e2e test signups, no team accounts.
    // Counting internal activity here would be manufacturing social proof.
    const { data: realProfiles } = await svc
      .from('profiles').select('id, is_public, onboarding_completed').eq('is_internal', false)
    const real = realProfiles ?? []
    const realIds = real.map((p) => p.id)
    const idFilter = realIds.length ? realIds : ['00000000-0000-0000-0000-000000000000']

    const [{ count: tradesJournaled }, { count: lessonsDone }] = await Promise.all([
      svc.from('trades').select('id', { count: 'exact', head: true }).in('user_id', idFilter),
      svc.from('lesson_completions').select('lesson_id', { count: 'exact', head: true }).in('user_id', idFilter),
    ])

    return NextResponse.json({
      tradesJournaled: tradesJournaled ?? 0,
      activeBetaUsers: real.filter((p) => p.onboarding_completed).length,
      publicTraders: real.filter((p) => p.is_public && p.onboarding_completed).length,
      lessonsCompleted: lessonsDone ?? 0,
      updatedAt: new Date().toISOString(),
    }, { headers: CORS })
  } catch {
    return NextResponse.json({ error: 'unavailable' }, { status: 503, headers: CORS })
  }
}
