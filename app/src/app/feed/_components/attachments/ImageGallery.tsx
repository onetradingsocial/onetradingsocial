'use client'

/* eslint-disable @next/next/no-img-element --
 * User-supplied images (Supabase storage, Google avatars) whose display size
 * comes entirely from CSS — percentages, a dynamic size prop, or viewport
 * units. next/image needs fixed dimensions or fill plus a positioned wrapper,
 * so converting is a layout change, and it routes every avatar through the
 * metered Vercel optimiser. Revisit if these ever show up as an LCP problem.
 */

import { useState } from 'react'

export function ImageGallery({ urls }: { urls: string[] }) {
  const [zoom, setZoom] = useState<string | null>(null)
  const n = Math.min(urls.length, 4)
  return (
    <>
      <div className="ts-gallery" data-n={n}>
        {urls.slice(0, 4).map((u) => <img key={u} src={u} alt="" onClick={() => setZoom(u)} />)}
      </div>
      {zoom && (
        <div className="ts-modal-backdrop" onClick={() => setZoom(null)}>
          <img src={zoom} alt="" style={{ maxWidth: '92vw', maxHeight: '90vh', borderRadius: 14 }} />
        </div>
      )}
    </>
  )
}
