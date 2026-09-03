'use client'

/* eslint-disable @next/next/no-img-element --
 * User-supplied images (Supabase storage, Google avatars) whose display size
 * comes entirely from CSS — percentages, a dynamic size prop, or viewport
 * units. next/image needs fixed dimensions or fill plus a positioned wrapper,
 * so converting is a layout change, and it routes every avatar through the
 * metered Vercel optimiser. Revisit if these ever show up as an LCP problem.
 */

import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getAvatarUploadUrl, saveAvatarUrl } from '@/app/actions/avatar'
import { prepareImageUpload, MAX_UPLOAD_BYTES, formatBytes } from '@/lib/image-prep'
import { PrivacyNote } from './LegalNotice'

const BUCKET = process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'OneTradingSocial'

export function AvatarUploader({ current }: { current: string | null }) {
  const [url, setUrl] = useState(current)
  const [status, setStatus] = useState<string>('')
  const inputRef = useRef<HTMLInputElement>(null)

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setStatus('Preparing…')

    // Audit item 11 F2 + F4. Avatars are the sharpest case for EXIF: they stay
    // in the PUBLIC bucket by design and the key is `avatars/{uid}.{ext}`, fully
    // predictable from a user id that anyone can enumerate — so a phone photo's
    // GPS was readable by anybody who could guess the URL, which is everybody.
    const prepared = await prepareImageUpload(file)
    if ('error' in prepared) { setStatus(prepared.error); return }

    setStatus('Uploading…')
    const signed = await getAvatarUploadUrl(prepared.contentType)
    if ('error' in signed) { setStatus(signed.error ?? 'Upload failed.'); return }

    const supabase = createClient()
    const { error } = await supabase.storage
      .from(BUCKET)
      .uploadToSignedUrl(signed.path, signed.token, prepared.blob, { upsert: true })
    if (error) { setStatus('Upload failed. Try again.'); return }

    const saved = await saveAvatarUrl(prepared.contentType)
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
        {/* APP 5, audit item 4 finding 6. avatars/ and covers/ stay in the
            PUBLIC bucket by design (0044) — the profile JSON-LD emits the URL
            for anonymous crawlers, which cannot follow a signed URL. */}
        <p className="faint mt-2" style={{ fontSize: 12 }}>
          PNG or JPEG, up to {formatBytes(MAX_UPLOAD_BYTES)}. Large images are resized, and
          location and camera data are removed before upload.
        </p>
        <PrivacyNote>Your profile photo is stored on a public address so it can appear on your public profile and in search results.</PrivacyNote>
      </div>
    </div>
  )
}
