/**
 * Client-side image preparation. Audit item 11, findings F2 and F4.
 *
 * ── WHY THE CLIENT, WHEN THE CLIENT CANNOT BE TRUSTED ────────────────────────
 *
 * All five image paths are direct-to-Supabase: the server mints a signed upload
 * URL and the browser PUTs the bytes straight to storage. **Our runtime never
 * sees a single byte**, so there is no server-side place to check a size or
 * strip metadata. That is a structural property of the upload design, not an
 * oversight, and it means this file is a UX and hygiene layer, never a security
 * boundary. The enforceable controls live where the bytes land:
 *
 *   - `storage.buckets.file_size_limit` — the only *enforced* size cap;
 *   - `storage.buckets.allowed_mime_types` — the explicit four-subtype
 *     allowlist that closed the SVG vector in F1 (migration 0044).
 *
 * Migration `0057_public_bucket_limits.sql` lowers the public bucket's cap from
 * 50 MB to the same 5 MB the private bucket already uses. Until that is
 * applied, an attacker who skips this code can still PUT 50 MB. Nothing here
 * claims otherwise.
 *
 * ── F2: no size limit anywhere ───────────────────────────────────────────────
 *
 * Not one uploader checked `file.size`. With `idx` 0-3 on post images and DM
 * attachments and 30 token mints per minute per user, a scripted client could
 * write on the order of 1.5 GB/minute into a bucket with no quota. Two live
 * objects were already 1.0 MB and 1.7 MB, so ordinary users genuinely do upload
 * unoptimised phone screenshots — this is a real page-weight problem today, not
 * only an abuse ceiling.
 *
 * ── F4: EXIF/GPS was never stripped ──────────────────────────────────────────
 *
 * There is no `sharp`, no `exifr`, no re-encode anywhere: bytes were stored
 * verbatim, metadata included. Trading screenshots have no EXIF, which is the
 * dominant case — but a phone photo of a monitor (common for "my setup" posts
 * and DM attachments) carries GPS coordinates, device model and a capture
 * timestamp. Avatars are the sharp edge: they stay in the PUBLIC bucket by
 * design and their keys are fully predictable from the anon-enumerable user
 * ids, so home-location GPS was retrievable for anyone who used a phone photo.
 *
 * Re-encoding through a canvas drops every metadata chunk as a side effect —
 * the browser decodes to pixels and re-encodes from pixels, and EXIF simply has
 * nowhere to survive. That is why one helper delivers both findings: the
 * downscale that fixes F2 is the same operation that fixes F4.
 *
 * ── WHY THE FORMAT IS PRESERVED ──────────────────────────────────────────────
 *
 * PNG in, PNG out; JPEG in, JPEG out. Converting PNG to JPEG would be smaller,
 * and would also flatten alpha to black — which is exactly what a profile photo
 * or a chart exported with a transparent background does not want. The stored
 * key's extension is derived from the content type on the server, so silently
 * changing the format here would also change the key, and `saveAvatarUrl`
 * computes the same key independently. Keep them agreeing.
 */

/** Matches the private bucket's existing cap and what 0057 sets on the public one. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

/**
 * Longest edge after downscaling. 2000px is above any realistic display size on
 * a feed card or a profile header while still cutting a modern phone photo
 * (4000px+) to roughly a quarter of its pixels.
 */
export const MAX_IMAGE_DIMENSION = 2000

/** JPEG quality on re-encode. 0.85 is the usual "no visible artefacts" floor. */
export const JPEG_QUALITY = 0.85

export type AllowedContentType = 'image/png' | 'image/jpeg'

export function isAllowedContentType(ct: string): ct is AllowedContentType {
  return ct === 'image/png' || ct === 'image/jpeg'
}

/** Normalise a File's type to the two the server's key builder understands. */
export function normaliseContentType(type: string): AllowedContentType {
  return type === 'image/png' ? 'image/png' : 'image/jpeg'
}

export function formatBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`
}

/**
 * Pure pre-flight check. Returns a message to show the user, or null.
 *
 * Kept separate from the canvas work so it is testable in node and so a caller
 * can reject a 40 MB file without decoding it first.
 */
export function imageFileProblem(file: { size: number; type: string; name?: string }): string | null {
  if (!isAllowedContentType(file.type)) {
    return 'Only PNG and JPEG images can be uploaded.'
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `That image is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_UPLOAD_BYTES)} — try a screenshot or a smaller export.`
  }
  if (file.size === 0) return 'That file is empty.'
  return null
}

/** Pure. Fit within `max` on the longest edge, preserving aspect ratio. */
export function scaledDimensions(width: number, height: number, max = MAX_IMAGE_DIMENSION): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= max || longest === 0) return { width, height }
  const ratio = max / longest
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) }
}

export type PreparedImage = { blob: Blob; contentType: AllowedContentType }

/**
 * Validate, downscale and re-encode. Strips EXIF as a side effect of the
 * re-encode. Returns `{ error }` with a message fit to show a user.
 *
 * Falls back to the ORIGINAL file if anything in the canvas path fails — a
 * browser that cannot decode the image should not block the upload, because the
 * bucket's MIME allowlist and size cap are the real controls either way. The
 * fallback is logged to the caller through `stripped: false` so a UI can say so
 * if it ever wants to.
 */
export async function prepareImageUpload(
  file: File,
  maxDimension = MAX_IMAGE_DIMENSION,
): Promise<(PreparedImage & { stripped: boolean }) | { error: string }> {
  const problem = imageFileProblem(file)
  if (problem) return { error: problem }

  const contentType = normaliseContentType(file.type)
  const original = { blob: file as Blob, contentType, stripped: false }

  // Guard for non-browser callers (tests, SSR) and for very old browsers.
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return original

  try {
    const bitmap = await createImageBitmap(file)
    const { width, height } = scaledDimensions(bitmap.width, bitmap.height, maxDimension)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) { bitmap.close?.(); return original }
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close?.()

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), contentType, contentType === 'image/jpeg' ? JPEG_QUALITY : undefined)
    })
    if (!blob) return original

    // A re-encode should not make things worse. If it somehow did and the
    // original is still inside the cap, the smaller of the two wins — except
    // that we would then be storing EXIF again, so only take that branch when
    // the difference is large enough to matter.
    if (blob.size > file.size * 1.5 && file.size <= MAX_UPLOAD_BYTES) return original
    if (blob.size > MAX_UPLOAD_BYTES) {
      return { error: `That image is still ${formatBytes(blob.size)} after resizing. Try a smaller one.` }
    }
    return { blob, contentType, stripped: true }
  } catch {
    return original
  }
}
