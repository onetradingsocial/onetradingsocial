import { HeadSkeleton, SectionSkeleton, SkeletonPage, TableSkeleton } from '../_components/Skeleton'

export default function Loading() {
  return (
    <SkeletonPage>
      <HeadSkeleton />
      <div className="ad-stack">
        <SectionSkeleton><TableSkeleton rows={6} cols={5} /></SectionSkeleton>
        <SectionSkeleton>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
            <TableSkeleton rows={3} cols={5} />
            <TableSkeleton rows={3} cols={5} />
            <TableSkeleton rows={3} cols={5} />
            <TableSkeleton rows={3} cols={5} />
          </div>
        </SectionSkeleton>
      </div>
    </SkeletonPage>
  )
}
