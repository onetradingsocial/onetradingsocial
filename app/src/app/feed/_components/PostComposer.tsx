'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { createPost, attachPostImages, type AttachmentType } from '@/app/actions/social'
import { TradePickerModal } from './TradePickerModal'

const BUCKET = process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'OneTradingSocial'

type Picked = { id: string; instrument: string; direction: string }

export function PostComposer() {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [type, setType] = useState<AttachmentType>('none')
  const [trade, setTrade] = useState<Picked | null>(null)
  const [images, setImages] = useState<File[]>([])
  const [options, setOptions] = useState<string[]>(['', ''])
  const [picker, setPicker] = useState(false)
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)

  function reset() { setBody(''); setType('none'); setTrade(null); setImages([]); setOptions(['', '']) }
  function clearAttachment() { setType('none'); setTrade(null); setImages([]); setOptions(['', '']) }

  function onImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).slice(0, 4)
    if (files.length) { setImages(files); setType('images') }
  }

  function submit() {
    setError('')
    start(async () => {
      const res = await createPost({ body, attachmentType: type, tradeId: trade?.id ?? null, pollOptions: type === 'poll' ? options : undefined })
      if (res.error || !res.postId) { setError(res.error ?? 'Failed.'); return }
      if (type === 'images' && images.length) {
        const supabase = createClient()
        const urls: string[] = []
        for (let i = 0; i < images.length; i++) {
          const f = images[i]; const ct = f.type === 'image/png' ? 'image/png' : 'image/jpeg'
          const signed = await fetch(`/api/post-image-url?postId=${res.postId}&idx=${i}&ct=${encodeURIComponent(ct)}`).then((r) => r.json())
          if (signed?.path && signed?.token) {
            await supabase.storage.from(BUCKET).uploadToSignedUrl(signed.path, signed.token, f, { upsert: true })
            urls.push(signed.publicUrl)
          }
        }
        if (urls.length) await attachPostImages(res.postId, urls)
      }
      reset(); router.refresh()
    })
  }

  return (
    <div className="ts-card ts-composer">
      <textarea className="ts-textarea" rows={3} maxLength={2000} value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={type === 'poll' ? 'Ask a question…' : 'Share an idea, a setup, or a win…'} />

      {type === 'trade' && trade && (
        <div className="ts-att-preview"><span>📈 {trade.instrument} <span className="faint" style={{ textTransform: 'capitalize' }}>{trade.direction}</span></span>
          <button type="button" className="ts-mini" onClick={clearAttachment}>Remove</button></div>
      )}
      {type === 'images' && images.length > 0 && (
        <>
          <div className="ts-thumbs">{images.map((f, i) => <img key={i} src={URL.createObjectURL(f)} alt="" />)}</div>
          <div className="ts-att-preview"><span>{images.length} image{images.length === 1 ? '' : 's'} attached</span>
            <button type="button" className="ts-mini" onClick={clearAttachment}>Remove</button></div>
        </>
      )}
      {type === 'poll' && (
        <div className="ts-pollbuild">
          {options.map((o, i) => (
            <input key={i} className="ts-input" placeholder={`Option ${i + 1}`} value={o}
              onChange={(e) => setOptions((arr) => arr.map((x, j) => j === i ? e.target.value : x))} />
          ))}
          <div style={{ display: 'flex', gap: 8 }}>
            {options.length < 4 && <button type="button" className="ts-mini" onClick={() => setOptions((a) => [...a, ''])}>+ Add option</button>}
            <button type="button" className="ts-mini" onClick={clearAttachment} style={{ marginLeft: 'auto' }}>Remove poll</button>
          </div>
        </div>
      )}

      <div className="ts-composer-foot">
        <div className="ts-attbar">
          <button type="button" className="ts-attach" data-active={type === 'trade'} onClick={() => setPicker(true)}>📈 Trade</button>
          <button type="button" className="ts-attach" data-active={type === 'images'} onClick={() => fileRef.current?.click()}>🖼 Image</button>
          <button type="button" className="ts-attach" data-active={type === 'poll'} onClick={() => setType('poll')}>📊 Poll</button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg" multiple className="hidden" onChange={onImages} />
        </div>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>{pending ? 'Posting…' : 'Post'}</button>
      </div>
      {error && <p className="ts-error" style={{ marginTop: 10 }}>{error}</p>}

      {picker && <TradePickerModal onClose={() => setPicker(false)} onPick={(t) => { setTrade(t); setType('trade'); setPicker(false) }} />}
    </div>
  )
}
