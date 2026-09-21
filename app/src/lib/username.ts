export const RESERVED_USERNAMES = [
  'app', 'login', 'signup', 'logout', 'signout', 'onboarding', 'settings',
  'auth', 'api', 'admin', 'journal', 'leaderboard', 'feed', 'home',
  'profile', 'u', 'static', '_next', 'assets', 'favicon',
  'error', 'not-found', 'loading', 'verification', 'learn', 'messages',
  'achievements', 'select-plan', 'welcome', 'demo', 'feature-board', 'changelog', 'for',
  'referrals', 'r',
] as const

/**
 * True for a first path segment that `/[username]` must never treat as a
 * profile: a reserved route name, or anything file-shaped (`robots.txt`,
 * `sitemap.xml`, `llms.txt`, `ads.txt`, `security.txt` ...).
 *
 * The dot rule is what closes the file-name hole, and it has to live here
 * rather than in validateUsername alone: the signup trigger
 * (`handle_new_user`) copies `raw_user_meta_data->>'username'` into the row
 * unvalidated, so a direct Auth API signup can store a name this app's own
 * forms would reject. validateUsername already forbids `.`, so no name created
 * through the app is excluded by it.
 */
export function isReservedProfileSegment(segment: string): boolean {
  const s = segment.toLowerCase()
  return (RESERVED_USERNAMES as readonly string[]).includes(s) || s.includes('.')
}

/** On success the caller gets the NORMALISED name back, and must store that
 *  rather than its own input. Validating a trimmed copy while writing the raw
 *  string is how " jennifer_johnson" reached `profiles.username` on 2026-09-15:
 *  the leading space passed validation and then went into the row, where it
 *  makes the profile URL wrong and makes " name" and "name" two different
 *  usernames. */
export type UsernameResult = { ok: true; name: string } | { ok: false; error: string }

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
  return { ok: true, name }
}
