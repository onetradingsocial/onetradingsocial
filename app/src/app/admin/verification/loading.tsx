// Five sections in page order. Every Panel here is untitled (<Panel flush>),
// so no panel heads. Section 1's rows are .ad-row-stack; the rest are flat.
import {
  HeadSkeleton, RowsSkeleton, SectionSkeleton, SkeletonPage, StatsSkeleton, TableSkeleton,
} from '../_components/Skeleton'

export default function Loading() {
  return (
    <SkeletonPage>
      <HeadSkeleton subLines={2} />
      <div className="ad-stack">
        <StatsSkeleton count={4} />
        {/* User reports */}
        <SectionSkeleton><RowsSkeleton rows={3} title={false} stacked /></SectionSkeleton>
        {/* Suspicious accounts */}
        <SectionSkeleton><RowsSkeleton rows={3} title={false} /></SectionSkeleton>
        {/* Broker connections needing attention */}
        <SectionSkeleton><TableSkeleton rows={4} cols={6} /></SectionSkeleton>
        {/* Failed imports — most recent 20 */}
        <SectionSkeleton><RowsSkeleton rows={6} title={false} /></SectionSkeleton>
        {/* Recent trade edits */}
        <SectionSkeleton><RowsSkeleton rows={6} title={false} /></SectionSkeleton>
      </div>
    </SkeletonPage>
  )
}
