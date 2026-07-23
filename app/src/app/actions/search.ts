// app/src/app/actions/search.ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { normalizeQuery, escapeIlike, type SearchResults, type UserResult, type PostResult } from '@/lib/search'

const EMPTY: SearchResults = { users: [], posts: [] }

export async function search(rawQuery: string): Promise<SearchResults> {
  const q = normalizeQuery(rawQuery)
  if (!q) return EMPTY

  const supabase = await createClient()
  const like = `%${escapeIlike(q)}%`

  const [usersRes, postsRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url, bio')
      .eq('is_public', true)
      .or(`username.ilike.${like},display_name.ilike.${like}`)
      .limit(5),
    supabase
      .from('posts')
      .select('id, body, created_at, author:profiles!posts_author_id_fkey(username, display_name, avatar_url, is_public)')
      .textSearch('body_tsv', q, { type: 'websearch' })
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  const users: UserResult[] = (usersRes.data ?? []).map((u) => ({
    id: u.id,
    username: u.username,
    displayName: u.display_name ?? null,
    avatarUrl: u.avatar_url ?? null,
    bio: u.bio ?? null,
  }))

  const posts: PostResult[] = (postsRes.data ?? [])
    .map((p) => {
      const author = (Array.isArray(p.author) ? p.author[0] : p.author) as
        | { username: string; display_name: string | null; avatar_url: string | null; is_public: boolean }
        | null
      return { p, author }
    })
    .filter((item): item is { p: typeof item.p; author: NonNullable<typeof item.author> } => item.author?.is_public === true)
    .slice(0, 5)
    .map(({ p, author }) => ({
      id: p.id,
      body: p.body,
      createdAt: p.created_at,
      author: {
        username: author.username,
        displayName: author.display_name ?? null,
        avatarUrl: author.avatar_url ?? null,
      },
    }))

  return { users, posts }
}
