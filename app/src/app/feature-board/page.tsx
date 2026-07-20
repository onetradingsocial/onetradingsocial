import { redirect } from 'next/navigation'
import { createClient, getSessionUser } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/server/admin'
import { FeatureBoardClient, type FrItem } from './FeatureBoardClient'
import type { FrStatus } from '@/lib/feature-board'

export const dynamic = 'force-dynamic'

export default async function FeatureBoardPage() {
  const supabase = await createClient()
  const user = await getSessionUser(supabase)
  if (!user) redirect('/login')

  const [{ data: requests }, { data: votes }, { data: myVotes }, { data: comments }] = await Promise.all([
    supabase.from('feature_requests')
      .select('id, title, body, status, author:profiles!feature_requests_author_id_fkey(username)')
      .order('created_at', { ascending: false }).limit(200),
    supabase.from('feature_request_votes').select('request_id'),
    supabase.from('feature_request_votes').select('request_id').eq('user_id', user.id),
    supabase.from('feature_request_comments')
      .select('request_id, body, created_at, author:profiles!feature_request_comments_author_id_fkey(username)')
      .order('created_at', { ascending: true }),
  ])

  const voteCounts = new Map<number, number>()
  for (const v of votes ?? []) voteCounts.set(v.request_id, (voteCounts.get(v.request_id) ?? 0) + 1)
  const mine = new Set((myVotes ?? []).map((v) => v.request_id))

  const commentsByReq = new Map<number, FrItem['comments']>()
  for (const c of comments ?? []) {
    const a = Array.isArray(c.author) ? c.author[0] : c.author
    const arr = commentsByReq.get(c.request_id) ?? []
    arr.push({ author: (a as { username: string } | null)?.username ?? null, body: c.body, createdAt: c.created_at })
    commentsByReq.set(c.request_id, arr)
  }

  const items: FrItem[] = (requests ?? []).map((r) => {
    const a = Array.isArray(r.author) ? r.author[0] : r.author
    return {
      id: r.id, title: r.title, body: r.body, status: r.status as FrStatus,
      author: (a as { username: string } | null)?.username ?? null,
      votes: voteCounts.get(r.id) ?? 0,
      voted: mine.has(r.id),
      comments: commentsByReq.get(r.id) ?? [],
    }
  })
  // Sort by votes desc (roadmap prominence), stable within status via original order.
  items.sort((a, b) => b.votes - a.votes)

  return (
    <main className="ts-page" style={{ maxWidth: 820 }}>
      <header className="lb-head"><div className="tx">
        <h1 className="ts-h1">Feature board</h1>
        <p>Suggest what to build next, vote on ideas, and follow what&apos;s planned, in progress and shipped. Votes guide the roadmap — they don&apos;t dictate it.</p>
      </div></header>
      <div className="mt-4">
        <FeatureBoardClient items={items} isAdmin={isAdmin(user)} />
      </div>
    </main>
  )
}
