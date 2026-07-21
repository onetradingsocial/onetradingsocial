import { HeadSkeleton, RowsSkeleton, SectionSkeleton, SkeletonPage } from '../_components/Skeleton'

export default function Loading() {
  return (
    <SkeletonPage>
      <HeadSkeleton />
      <div className="ad-stack">
        <SectionSkeleton><RowsSkeleton rows={4} title={false} /></SectionSkeleton>
        <SectionSkeleton><RowsSkeleton rows={3} title={false} /></SectionSkeleton>
        <SectionSkeleton><RowsSkeleton rows={2} title={false} /></SectionSkeleton>
      </div>
    </SkeletonPage>
  )
}
