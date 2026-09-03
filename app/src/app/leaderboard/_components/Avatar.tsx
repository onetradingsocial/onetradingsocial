/* eslint-disable @next/next/no-img-element --
 * User-supplied images (Supabase storage, Google avatars) whose display size
 * comes entirely from CSS — percentages, a dynamic size prop, or viewport
 * units. next/image needs fixed dimensions or fill plus a positioned wrapper,
 * so converting is a layout change, and it routes every avatar through the
 * metered Vercel optimiser. Revisit if these ever show up as an LCP problem.
 */

// Round trader avatar: photo when present, else the name initial on a brand tint.
export function Avatar({
  src, name, size = 38, ring = false,
}: { src: string | null; name: string; size?: number; ring?: boolean }) {
  return (
    <span className={'lb-av' + (ring ? ' ring' : '')} style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}>
      {src ? <img src={src} alt="" /> : (name || '?').charAt(0).toUpperCase()}
    </span>
  )
}
