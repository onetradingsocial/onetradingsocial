'use client'

import { useState, useRef } from 'react'
import { TradePickerModal } from '@/app/feed/_components/TradePickerModal'
import type { Attachment } from '@/lib/messaging'

async function uploadImage(file: File, draftId: string, idx: number): Promise<string | null> {
  const ct = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
  const res = await fetch(`/api/message-image-url?draftId=${draftId}&idx=${idx}&ct=${ct}`)
  if (!res.ok) return null
  const { token, path, publicUrl } = await res.json()
  const { createClient } = await import('@/lib/supabase/client')
  const supabase = createClient()
  const { error } = await supabase.storage.from('OneTradingSocial').uploadToSignedUrl(path, token, file)
  if (error) return null
  return publicUrl as string
}

export function MessageComposer({
  recipientId, disabled, onTyping, onSend,
}: {
  recipientId: string
  disabled: boolean
  onTyping: () => void
  onSend: (body: string, attachments: Attachment[]) => Promise<{ error?: string }>
}) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFiles(files: FileList | null) {
    if (!files) return
    const draftId = crypto.randomUUID()
    const current = attachments.filter((a) => a.type === 'image').length
    const room = 4 - current
    const picked = Array.from(files).slice(0, room)
    setBusy(true)
    const uploaded: Attachment[] = []
    for (let i = 0; i < picked.length; i++) {
      const url = await uploadImage(picked[i], draftId, current + i)
      if (url) uploaded.push({ type: 'image', url })
    }
    setAttachments((prev) => [...prev, ...uploaded])
    setBusy(false)
  }

  async function submit() {
    const body = text.trim()
    if (!body && attachments.length === 0) return
    setBusy(true); setError(null)
    const res = await onSend(body, attachments)
    setBusy(false)
    if (res.error) { setError(res.error); return }
    setText(''); setAttachments([])
  }

  const hasTrade = attachments.some((a) => a.type === 'trade')

  return (
    <div className="ts-msg-composer">
      {error && <p className="ts-msg-error" role="alert">{error}</p>}
      {attachments.length > 0 && (
        <div className="ts-msg-composer-atts">
          {attachments.map((a, i) => (
            <span key={i} className="ts-msg-att-chip">
              {a.type === 'image' ? '📷 Image' : '📈 Trade'}
              <button type="button" onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}>✕</button>
            </span>
          ))}
        </div>
      )}
      <div className="ts-msg-composer-row">
        <button type="button" className="ts-msg-attach-btn" title="Add image" disabled={busy} onClick={() => fileRef.current?.click()}>＋</button>
        <button type="button" className="ts-msg-attach-btn" title="Attach trade" disabled={busy || hasTrade} onClick={() => setShowPicker(true)}>📈</button>
        <input
          ref={fileRef} type="file" accept="image/png,image/jpeg" multiple hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
        <textarea
          className="ts-msg-input"
          placeholder="Write a message…"
          value={text}
          disabled={disabled || busy}
          onChange={(e) => { setText(e.target.value); onTyping() }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit() } }}
        />
        <button type="button" className="ts-msg-send" disabled={disabled || busy} onClick={() => void submit()}>▸</button>
      </div>
      {showPicker && (
        <TradePickerModal
          onPick={(t) => { setAttachments((prev) => [...prev.filter((a) => a.type !== 'trade'), { type: 'trade', tradeId: t.id }]); setShowPicker(false) }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  )
}
