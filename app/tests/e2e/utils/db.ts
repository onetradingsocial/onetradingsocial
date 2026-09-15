// Service-role Supabase client for e2e cleanup. Playwright does not load
// .env.local the way Next.js does — the loader now lives in utils/env.ts, so
// every spec reads the same environment instead of each file solving it again.
import { createClient } from '@supabase/supabase-js'
import { e2eEnv } from './env'

export function createServiceClient() {
  const env = e2eEnv()
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('e2e cleanup needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (env or app/.env.local)')
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

export async function deleteCourseBySlug(slug: string) {
  const svc = createServiceClient()
  const { data: course } = await svc.from('courses').select('id').eq('slug', slug).maybeSingle()
  if (!course) return
  await svc.from('lessons').delete().eq('course_id', course.id)
  await svc.from('courses').delete().eq('id', course.id)
}
