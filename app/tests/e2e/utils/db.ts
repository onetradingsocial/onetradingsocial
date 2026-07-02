// Service-role Supabase client for e2e cleanup. Playwright does not load
// .env.local the way Next.js does, so parse it ourselves and let real env win.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

function loadEnvLocal(): Record<string, string> {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    const out: Record<string, string> = {}
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!m) continue
      out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
    }
    return out
  } catch {
    return {}
  }
}

export function createServiceClient() {
  const env = { ...loadEnvLocal(), ...process.env }
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
