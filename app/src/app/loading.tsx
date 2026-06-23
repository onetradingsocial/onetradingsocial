import { SkelCard } from './_components/PageSkeleton'

export default function Loading() {
  return (
    <main className="ts-page ts-feed">
      <div className="ts-feed-main ts-skel-stack">
        <SkelCard lines={4} />
        <SkelCard lines={2} />
        <SkelCard lines={3} />
        <SkelCard lines={5} />
      </div>
      <aside className="ts-feed-side ts-skel-stack">
        <SkelCard lines={4} />
        <SkelCard lines={3} />
      </aside>
    </main>
  )
}
