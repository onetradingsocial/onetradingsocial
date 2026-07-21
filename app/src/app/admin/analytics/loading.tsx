import {
  HeadSkeleton, MetersSkeleton, SectionSkeleton, SkeletonPage, StatsSkeleton,
} from '../_components/Skeleton'

export default function Loading() {
  return (
    <SkeletonPage>
      <HeadSkeleton wide />
      <div className="ad-stack">
        <SectionSkeleton><MetersSkeleton rows={5} /></SectionSkeleton>
        <SectionSkeleton><StatsSkeleton count={4} /></SectionSkeleton>
        <SectionSkeleton><MetersSkeleton rows={4} /></SectionSkeleton>
        <SectionSkeleton><StatsSkeleton count={3} /></SectionSkeleton>
      </div>
    </SkeletonPage>
  )
}
