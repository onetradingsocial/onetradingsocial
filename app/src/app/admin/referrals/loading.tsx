import { HeadSkeleton, SkeletonPage, StatsSkeleton, TableSkeleton } from '../_components/Skeleton'

export default function Loading() {
  return (
    <SkeletonPage>
      <HeadSkeleton subLines={2} />
      <div className="adm-stack">
        <StatsSkeleton count={4} />
        {/* <Panel title="By referrer" flush scroll> */}
        <TableSkeleton rows={6} cols={7} title />
      </div>
    </SkeletonPage>
  )
}
