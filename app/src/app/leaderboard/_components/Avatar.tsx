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
