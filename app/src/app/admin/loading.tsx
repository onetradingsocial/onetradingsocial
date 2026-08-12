import { HeadSkeleton, RowsSkeleton, SkeletonPage, StatsSkeleton } from './_components/Skeleton'

export default function Loading() {
  return (
    <SkeletonPage>
      <HeadSkeleton subLines={2} />
      <div style={{ display: 'grid', gap: 22 }}>
        <StatsSkeleton count={5} />
        <RowsSkeleton rows={6} />
      </div>
    </SkeletonPage>
  )
}
