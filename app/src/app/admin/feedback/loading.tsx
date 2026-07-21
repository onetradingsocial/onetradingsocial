import { HeadSkeleton, RowsSkeleton, SkeletonPage } from '../_components/Skeleton'

export default function Loading() {
  return (
    <SkeletonPage>
      <HeadSkeleton />
      <RowsSkeleton rows={8} />
    </SkeletonPage>
  )
}
