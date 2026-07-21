import { HeadSkeleton, RowsSkeleton, SkeletonPage, StatsSkeleton } from './_components/Skeleton'

export default function Loading() {
  return (
    <SkeletonPage>
      <HeadSkeleton />
      <div style={{ display: 'grid', gap: 22 }}>
        <StatsSkeleton count={5} />
        <RowsSkeleton rows={6} />
      </div>
    </SkeletonPage>
  )
}
