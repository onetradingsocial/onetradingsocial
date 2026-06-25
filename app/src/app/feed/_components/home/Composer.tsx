'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { createPost, attachPostImages, type AttachmentType } from '@/app/actions/social'
import { TradePickerModal } from '../TradePickerModal'
import { Icon, Avatar } from './atoms'
import type { HomeData } from './types'

const BUCKET = process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'OneTradingSocial'

type Picked = { id: string; instrument: string; direction: string }

export function Composer({ data }: { data: HomeData }) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [type, setType] = useState<AttachmentType>('none')
  const [trade, setTrade] = useState<Picked | null>(null)
  const [images, setImages] = useState<File[]>([])
  const [options, setOptions] = useState<string[]>(['', ''])
  const [picker, setPicker] = useState(false)
  const [focus, setFocus] = useState(false)
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  function reset() { setBody(''); setType('none'); setTrade(null); setImages([]); setOptions(['', '']) }
  function clearAttachment() { setType('none'); setTrade(null); setImages([]); setOptions(['', '']) }
  function grow(el: HTMLTextAreaElement | null) { if (!el) return; el.style.height = 'auto'; el.style.height = Math.max(26, el.scrollHeight) + 'px' }

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

  const canPost = body.trim().length > 0 || type !== 'none'

  return (
    <div className={'h-composer' + (focus ? ' focus' : '')}>
      <div className="h-composer-top">
        <Avatar seed={data.handle} src={data.selfAvatar} name={data.name} size={42} ring />
        <textarea
          ref={taRef}
          className="h-composer-input"
          placeholder={type === 'poll' ? 'Ask a question…' : `What's on your mind, ${data.name}? Share a setup, a lesson, or a win…`}
          value={body}
          onChange={(e) => { setBody(e.target.value); grow(e.target) }}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          rows={1}
          maxLength={2000}
        />
      </div>

      {type === 'trade' && trade && (
        <div style={{ margin: '0 16px 10px', padding: '10px 12px', borderRadius: 11, border: '1px solid var(--line-vio)', background: 'rgba(124,92,230,0.06)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
          <Icon name="bolt" size={15} style={{ color: 'var(--violet-br)' }} />
          <span>{trade.instrument} <span style={{ color: 'var(--faint)', textTransform: 'capitalize', fontWeight: 500 }}>{trade.direction}</span></span>
          <button className="h-react" style={{ marginLeft: 'auto', height: 26 }} onClick={clearAttachment}>Remove</button>
        </div>
      )}
      {type === 'images' && images.length > 0 && (
        <div style={{ margin: '0 16px 10px' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{images.map((f, i) => <img key={i} src={URL.createObjectURL(f)} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--line)' }} />)}</div>
          <button className="h-react" style={{ marginTop: 6, height: 26 }} onClick={clearAttachment}>Remove</button>
        </div>
      )}
      {type === 'poll' && (
        <div style={{ margin: '0 16px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {options.map((o, i) => (
            <input key={i} className="h-input" placeholder={`Option ${i + 1}`} value={o}
              onChange={(e) => setOptions((arr) => arr.map((x, j) => j === i ? e.target.value : x))} />
          ))}
          <div style={{ display: 'flex', gap: 8 }}>
            {options.length < 4 && <button className="h-react" style={{ height: 28 }} onClick={() => setOptions((a) => [...a, ''])}>+ Add option</button>}
            <button className="h-react" style={{ height: 28, marginLeft: 'auto' }} onClick={clearAttachment}>Remove poll</button>
          </div>
        </div>
      )}

      <div className="h-composer-attach">
        <button className="h-attach acc-trade" data-active={type === 'trade'} onClick={() => setPicker(true)}><Icon name="bolt" size={16} /> Attach trade</button>
        <button className="h-attach acc-chart" data-active={type === 'images'} onClick={() => fileRef.current?.click()}><Icon name="image" size={16} /> Chart</button>
        <button className="h-attach acc-poll" data-active={type === 'poll'} onClick={() => setType('poll')}><Icon name="poll" size={16} /> Poll</button>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg" multiple className="hidden" onChange={onImages} />
      </div>
      <div className="h-composer-foot">
        <span className="h-vis"><Icon name="globe" size={14} /> Everyone</span>
        <button className="h-btn h-btn-grad h-btn-sm" style={{ marginLeft: 'auto', opacity: canPost && !pending ? 1 : 0.55, pointerEvents: canPost && !pending ? 'auto' : 'none' }} onClick={submit}>
          <Icon name="arrowRight" size={15} /> {pending ? 'Posting…' : 'Post'}
        </button>
      </div>
      {error && <p className="ts-error" style={{ margin: '0 16px 12px' }}>{error}</p>}

      {picker && <TradePickerModal onClose={() => setPicker(false)} onPick={(t) => { setTrade(t); setType('trade'); setPicker(false) }} />}
    </div>
  )
}
