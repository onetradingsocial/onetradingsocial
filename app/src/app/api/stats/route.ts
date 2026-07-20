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
    const [{ count: tradesJournaled }, { data: realUsers }, { count: publicTraders }, { count: lessonsDone }] =
      await Promise.all([
        svc.from('trades').select('id', { count: 'exact', head: true }),
        svc.from('profiles').select('id').eq('is_internal', false).eq('onboarding_completed', true),
        svc.from('profiles').select('id', { count: 'exact', head: true })
          .eq('is_internal', false).eq('is_public', true).eq('onboarding_completed', true),
        svc.from('lesson_completions').select('lesson_id', { count: 'exact', head: true }),
      ])

    return NextResponse.json({
      tradesJournaled: tradesJournaled ?? 0,
      activeBetaUsers: (realUsers ?? []).length,
      publicTraders: publicTraders ?? 0,
      lessonsCompleted: lessonsDone ?? 0,
      updatedAt: new Date().toISOString(),
    }, { headers: CORS })
  } catch {
    return NextResponse.json({ error: 'unavailable' }, { status: 503, headers: CORS })
  }
}
