'use client'

import { useState, useTransition } from 'react'
import { replyToFeedback } from '@/app/actions/admin'
import { FEEDBACK_MAX } from '@/lib/feedback'
import { When } from './ui'

/**
 * Answer one feedback item from the triage list (0066).
 *
 * Collapsed to a single line by default: the list is scanned far more often
 * than it is answered, and a textarea per row would bury the messages under
 * the controls. An existing reply stays visible unopened, because "has this
 * been answered" is the thing an admin reads the row for.
 *
 * Optimistic on success only — the reply text and timestamp are held locally
 * once the action returns, so the row reads correctly before the revalidated
 * page arrives. A failure leaves the draft in the box to retry or edit.
 */
export function FeedbackReply({ id, reply, repliedAt }: {
  id: string
  reply: string | null
  repliedAt: string | null
}) {
  const [saved, setSaved] = useState<{ body: string; at: string } | null>(
    reply ? { body: reply, at: repliedAt ?? '' } : null,
  )
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(reply ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function send() {
    setError(null)
    start(async () => {
      const res = await replyToFeedback(id, draft)
      if (res.error) { setError(res.error); return }
      setSaved({ body: draft.trim(), at: new Date().toISOString() })
      setOpen(false)
    })
  }

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {saved && !open && (
        <div className="adm-note" style={{ alignItems: 'flex-start' }}>
          <span className="eyebrow">Replied</span>
          {saved.at && <When iso={saved.at} />}
          <span style={{ whiteSpace: 'pre-wrap', flex: 1, minWidth: 0, color: 'var(--text)' }}>{saved.body}</span>
        </div>
      )}

      {open ? (
        <>
          <textarea
            className="ts-textarea"
            aria-label="Reply to this feedback"
            rows={3}
            maxLength={FEEDBACK_MAX}
            value={draft}
            disabled={pending}
            placeholder="Answer the person who sent this…"
            onChange={(e) => setDraft(e.target.value)}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" type="button" disabled={pending || !draft.trim()} onClick={send}>
              {pending ? 'Sending…' : saved ? 'Replace reply' : 'Send reply'}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              disabled={pending}
              onClick={() => { setOpen(false); setDraft(saved?.body ?? ''); setError(null) }}
            >
              Cancel
            </button>
            <span className="adm-kv">{draft.trim().length}/{FEEDBACK_MAX}</span>
            {error && <span style={{ color: 'var(--down)', fontSize: 13 }}>{error}</span>}
          </div>
        </>
      ) : (
        <div>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => setOpen(true)}>
            {saved ? 'Edit reply' : 'Reply'}
          </button>
        </div>
      )}
    </div>
  )
}
