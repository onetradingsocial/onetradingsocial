'use client'

import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getAvatarUploadUrl, saveAvatarUrl } from '@/app/actions/avatar'

const BUCKET = process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'OneTradingSocial'

export function AvatarUploader({ current }: { current: string | null }) {
  const [url, setUrl] = useState(current)
  const [status, setStatus] = useState<string>('')
  const inputRef = useRef<HTMLInputElement>(null)

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setStatus('Uploading…')

    const signed = await getAvatarUploadUrl(file.type)
    if ('error' in signed) { setStatus(signed.error ?? 'Upload failed.'); return }

    const supabase = createClient()
    const { error } = await supabase.storage
      .from(BUCKET)
      .uploadToSignedUrl(signed.path, signed.token, file, { upsert: true })
    if (error) { setStatus('Upload failed. Try again.'); return }

    const saved = await saveAvatarUrl(file.type)
    if ('error' in saved) { setStatus(saved.error ?? 'Upload failed.'); return }
    setUrl(saved.publicUrl)
    setStatus('Saved.')
  }

  return (
    <div className="flex items-center gap-5">
      {url
        ? <img src={url} alt="avatar" className="ts-avatar" />
        : <div className="ts-avatar ts-avatar--ph">+</div>}
      <div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => inputRef.current?.click()}>
          {url ? 'Change photo' : 'Upload photo'}
        </button>
        <input ref={inputRef} type="file" accept="image/png,image/jpeg" onChange={onChange} className="hidden" />
        {status && <p className="faint mt-2" style={{ fontSize: 13 }}>{status}</p>}
      </div>
    </div>
  )
}
