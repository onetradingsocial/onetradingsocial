import {
  HeadSkeleton, RowsSkeleton, SectionSkeleton, SkeletonPage, StatsSkeleton, TableSkeleton,
} from '../_components/Skeleton'

export default function Loading() {
  return (
    <SkeletonPage>
      <HeadSkeleton />
      <div className="ad-stack">
        <StatsSkeleton count={4} />
        <SectionSkeleton><RowsSkeleton rows={3} title={false} /></SectionSkeleton>
        <SectionSkeleton><RowsSkeleton rows={3} title={false} /></SectionSkeleton>
        <SectionSkeleton><TableSkeleton rows={4} cols={6} /></SectionSkeleton>
      </div>
    </SkeletonPage>
  )
}
