export const RESERVED_USERNAMES = [
  'app', 'login', 'signup', 'logout', 'signout', 'onboarding', 'settings',
  'auth', 'api', 'admin', 'journal', 'leaderboard', 'feed', 'home',
  'profile', 'u', 'static', '_next', 'assets', 'favicon',
] as const

export type UsernameResult = { ok: true } | { ok: false; error: string }

const USERNAME_RE = /^[a-zA-Z0-9_]+$/

export function validateUsername(raw: string): UsernameResult {
  const name = raw.trim()
  if (name.length < 3 || name.length > 20) {
    return { ok: false, error: 'Username must be 3-20 characters.' }
  }
  if (!USERNAME_RE.test(name)) {
    return { ok: false, error: 'Use letters, numbers, and underscores only.' }
  }
  if ((RESERVED_USERNAMES as readonly string[]).includes(name.toLowerCase())) {
    return { ok: false, error: 'That username is reserved.' }
  }
  return { ok: true }
}
