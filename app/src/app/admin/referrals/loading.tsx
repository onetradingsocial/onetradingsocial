import { HeadSkeleton, SkeletonPage, StatsSkeleton, TableSkeleton } from '../_components/Skeleton'

export default function Loading() {
  return (
    <SkeletonPage>
      <HeadSkeleton />
      <div className="ad-stack">
        <StatsSkeleton count={4} />
        <TableSkeleton rows={6} cols={7} />
      </div>
    </SkeletonPage>
  )
}
