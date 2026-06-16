'use client'

import { useRef, useState } from 'react'
import { getAvatarUploadUrl, saveAvatarUrl } from '@/app/actions/avatar'

export function AvatarUploader({ current }: { current: string | null }) {
  const [url, setUrl] = useState(current)
  const [status, setStatus] = useState<string>('')
  const inputRef = useRef<HTMLInputElement>(null)

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setStatus('Uploading…')
    const signed = await getAvatarUploadUrl(file.type)
    if ('error' in signed) { setStatus(signed.error); return }
    const put = await fetch(signed.url, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
    if (!put.ok) { setStatus('Upload failed. Try again.'); return }
    await saveAvatarUrl(signed.publicUrl)
    setUrl(signed.publicUrl)
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
