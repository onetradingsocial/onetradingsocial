export function Brand() {
  return (
    <span className="ts-logo">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/app/logo.png" alt="" className="ts-logo-mark" width={28} height={28} />
      <span>
        Trading<span className="grad-text">Social</span>
      </span>
    </span>
  )
}
