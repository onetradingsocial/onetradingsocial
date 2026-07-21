import { HeadSkeleton, SkeletonPage, TableSkeleton } from '../_components/Skeleton'

export default function Loading() {
  return (
    <SkeletonPage>
      <HeadSkeleton wide />
      <div style={{ display: 'grid', gap: 14 }}>
        <TableSkeleton rows={4} cols={5} />
        <TableSkeleton rows={6} cols={5} />
        <TableSkeleton rows={5} cols={5} />
      </div>
    </SkeletonPage>
  )
}
