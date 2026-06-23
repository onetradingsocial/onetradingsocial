import { SkelHead, SkelCard } from '../_components/PageSkeleton'

export default function Loading() {
  return (
    <main className="ts-page ts-feed lb-app">
      <div className="ts-feed-main lb-main ts-skel-stack">
        <SkelHead />
        <SkelCard lines={2} />
        <SkelCard lines={8} />
      </div>
      <aside className="ts-feed-side">
        <SkelCard lines={4} />
      </aside>
    </main>
  )
}
