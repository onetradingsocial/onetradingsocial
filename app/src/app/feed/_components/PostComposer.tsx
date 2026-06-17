'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createPost } from '@/app/actions/social'

export function PostComposer() {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [error, setError] = useState('')
  const [pending, start] = useTransition()

  function onSubmit(formData: FormData) {
    setError('')
    start(async () => {
      const r = await createPost(formData)
      if (r.error) { setError(r.error); return }
      formRef.current?.reset()
      router.refresh()
    })
  }

  return (
    <form ref={formRef} action={onSubmit} className="ts-card ts-composer">
      <textarea name="body" className="ts-textarea" rows={3} maxLength={2000}
        placeholder="Share an idea, a setup, or a win…" />
      <div className="ts-composer-foot">
        <div className="ts-composer-attach">
          <button type="button" className="ts-attach" disabled title="Attach trade — coming soon">📈 Trade</button>
          <button type="button" className="ts-attach" disabled title="Attach image — coming soon">🖼 Image</button>
          <button type="button" className="ts-attach" disabled title="Add poll — coming soon">📊 Poll</button>
          <span className="ts-soon">soon</span>
        </div>
        <button className="btn btn-primary" disabled={pending}>{pending ? 'Posting…' : 'Post'}</button>
      </div>
      {error && <p className="ts-error" style={{ marginTop: 10 }}>{error}</p>}
    </form>
  )
}
