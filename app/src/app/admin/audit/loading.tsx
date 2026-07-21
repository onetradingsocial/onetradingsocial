import { HeadSkeleton, SkeletonPage, TableSkeleton } from '../_components/Skeleton'

export default function Loading() {
  return (
    <SkeletonPage>
      <HeadSkeleton />
      <TableSkeleton rows={10} cols={5} />
    </SkeletonPage>
  )
}
