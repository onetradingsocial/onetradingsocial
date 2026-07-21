'use client'

import { useState, useTransition } from 'react'

/**
 * Publish state as a button: the label states what IS, the title states what
 * clicking does — so the control never reads as an ambiguous instruction.
 */
export function PublishToggle({ published, action }: { published: boolean; action: (next: boolean) => Promise<{ error?: string }> }) {
  const [on, setOn] = useState(published)
  const [pending, start] = useTransition()
  return (
    <button
      type="button"
      className={`btn btn-sm ${on ? 'btn-ghost' : 'btn-primary'}`}
      disabled={pending}
      title={on ? 'Click to unpublish' : 'Click to publish'}
      aria-pressed={on}
      onClick={() => start(async () => { const r = await action(!on); if (!r.error) setOn(!on) })}
    >
      <span
        aria-hidden
        style={{
          width: 7, height: 7, borderRadius: '50%',
          background: on ? 'var(--up)' : 'currentColor',
          opacity: on ? 1 : 0.65,
        }}
      />
      {pending ? 'Saving…' : on ? 'Published' : 'Publish'}
    </button>
  )
}
