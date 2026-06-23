'use client'

import { useState, useTransition } from 'react'

export function PublishToggle({ published, action }: { published: boolean; action: (next: boolean) => Promise<{ error?: string }> }) {
  const [on, setOn] = useState(published)
  const [pending, start] = useTransition()
  return (
    <button type="button" className="btn btn-sm" disabled={pending}
      onClick={() => start(async () => { const r = await action(!on); if (!r.error) setOn(!on) })}>
      {on ? 'Published — click to unpublish' : 'Draft — click to publish'}
    </button>
  )
}
