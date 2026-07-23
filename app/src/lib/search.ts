export type UserResult = {
  id: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  bio: string | null
}

export type PostResult = {
  id: string
  body: string
  createdAt: string
  author: { username: string; displayName: string | null; avatarUrl: string | null }
}

export type SearchResults = { users: UserResult[]; posts: PostResult[] }

// Trim, strip PostgREST-filter-unsafe characters, require >= 2 chars.
// Keeps letters, digits, spaces, and @ _ - (valid in usernames / handles).
export function normalizeQuery(raw: string): string | null {
  const cleaned = (raw ?? '')
    .replace(/[,().:'"]/g, '')
    .trim()
  return cleaned.length >= 2 ? cleaned : null
}

// Escape ILIKE wildcards so % and _ are literal.
export function escapeIlike(q: string): string {
  return q.replace(/[%_]/g, (c) => `\\${c}`)
}
