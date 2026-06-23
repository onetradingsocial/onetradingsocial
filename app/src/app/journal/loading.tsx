import { SkelHead, SkelCard } from '../_components/PageSkeleton'

export default function Loading() {
  return (
    <main className="ts-page ts-skel-stack">
      <SkelHead />
      <SkelCard lines={3} />
      <SkelCard lines={6} />
    </main>
  )
}
