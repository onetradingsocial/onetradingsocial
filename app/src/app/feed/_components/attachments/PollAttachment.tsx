'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { votePoll } from '@/app/actions/social'
import { pollResults } from '@/lib/post'

type Opt = { id: string; label: string }
export function PollAttachment({ postId, options, votes, myVote }: {
  postId: string; options: Opt[]; votes: { option_id: string }[]; myVote: string | null
}) {
  const router = useRouter()
  const [mine, setMine] = useState<string | null>(myVote)
  const [localVotes, setLocalVotes] = useState(votes)
  const [, start] = useTransition()
  const { results, total } = pollResults(options, localVotes, mine)
  const revealed = mine != null

  function vote(optionId: string) {
    if (mine === optionId) return
    setLocalVotes((vs) => {
      let removed = false
      const kept = mine
        ? vs.filter((v) => { if (!removed && v.option_id === mine) { removed = true; return false } return true })
        : vs.slice()
      return [...kept, { option_id: optionId }]
    })
    setMine(optionId)
    start(async () => { await votePoll(postId, optionId); router.refresh() })
  }

  return (
    <div className="ts-poll">
      {results.map((r) => (
        <button key={r.id} type="button" className="ts-poll-opt" data-mine={r.votedFor} onClick={() => vote(r.id)}>
          {revealed && <span className="ts-poll-fill" style={{ width: `${r.pct}%` }} />}
          <span>{r.label}</span>
          {revealed && <span>{r.pct}%</span>}
        </button>
      ))}
      <span className="ts-poll-total">{total} vote{total === 1 ? '' : 's'}{revealed ? '' : ' · tap to vote'}</span>
    </div>
  )
}
