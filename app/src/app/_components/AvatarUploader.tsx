'use client'

import { useState } from 'react'
import { getAvatarUploadUrl, saveAvatarUrl } from '@/app/actions/avatar'

export function AvatarUploader({ current }: { current: string | null }) {
  const [url, setUrl] = useState(current)
  const [status, setStatus] = useState<string>('')

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
    <div className="space-y-2">
      {url && <img src={url} alt="avatar" className="h-20 w-20 rounded-full object-cover" />}
      <input type="file" accept="image/png,image/jpeg" onChange={onChange} />
      {status && <p className="text-sm text-gray-500">{status}</p>}
    </div>
  )
}
