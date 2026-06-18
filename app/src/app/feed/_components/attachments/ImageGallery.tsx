'use client'

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
