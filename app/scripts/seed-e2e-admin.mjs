import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }),
)

const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY

// HARD GUARD: never seed an admin against production.
if (!url || url.includes('jmpanzrjxflovdfwcbye')) {
  console.error('REFUSING: NEXT_PUBLIC_SUPABASE_URL is production or missing:', url)
  process.exit(1)
}
console.log('target project:', url.replace(/https:\/\/([a-z]+)\..*/, '$1'), '(dev)')

const EMAIL = 'e2e-admin@tradingsocial.io'
const PASSWORD = 'password123' // SEEDED_PASSWORD — see tests/e2e/utils/creds.ts
const USERNAME = 'e2e_admin'

const svc = createClient(url, key, { auth: { persistSession: false } })

// Reuse the account if a previous run made it, so this is safe to re-run.
const { data: list } = await svc.auth.admin.listUsers({ page: 1, perPage: 1000 })
let user = list?.users?.find((u) => u.email === EMAIL)

if (user) {
  console.log('existing admin found, resetting password + confirming')
  await svc.auth.admin.updateUserById(user.id, { password: PASSWORD, email_confirm: true })
} else {
  const { data, error } = await svc.auth.admin.createUser({
    email: EMAIL, password: PASSWORD, email_confirm: true,
    user_metadata: { username: USERNAME },
  })
  if (error) { console.error('createUser failed:', error.message); process.exit(1) }
  user = data.user
  console.log('created admin user')
}

// The signup trigger makes the profile. Two things have to be set on it:
//
//   onboarding_completed — middleware bounces every /admin request to
//     /onboarding without it.
//   welcome_tier_seen    — an admin resolves to tier 'pro', so a profile that
//     has never acknowledged the welcome popup gets it on the first admin page,
//     and its full-screen backdrop then swallows the clicks the admin specs are
//     trying to make. It surfaces as a click timeout on a button that is
//     visibly present, nowhere near the cause.
const { error: pErr } = await svc.from('profiles')
  .update({
    onboarding_completed: true,
    username: USERNAME,
    display_name: 'E2E Admin',
    welcome_tier_seen: 'pro',
  })
  .eq('id', user.id)
if (pErr) { console.error('profile update failed:', pErr.message); process.exit(1) }

const { data: prof } = await svc.from('profiles')
  .select('username, onboarding_completed, welcome_tier_seen, is_internal').eq('id', user.id).single()

console.log('email               :', EMAIL)
console.log('profile             :', JSON.stringify(prof))
console.log('email_confirmed     :', !!user.email_confirmed_at || 'set via admin API')
