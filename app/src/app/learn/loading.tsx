import { SkelHead, SkelCard } from '../_components/PageSkeleton'

export default function Loading() {
  return (
    <main className="ts-page ts-skel-stack" style={{ maxWidth: 820 }}>
      <SkelHead />
      <div className="learn-grid mt-6">
        <SkelCard lines={3} />
        <SkelCard lines={3} />
        <SkelCard lines={3} />
        <SkelCard lines={3} />
      </div>
    </main>
  )
}
