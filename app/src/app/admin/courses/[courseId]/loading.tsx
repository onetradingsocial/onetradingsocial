import { FormSkeleton, HeadSkeleton, RowsSkeleton, SkeletonPage } from '../../_components/Skeleton'

export default function Loading() {
  return (
    <SkeletonPage>
      <HeadSkeleton />
      <div style={{ display: 'grid', gap: 16 }}>
        <FormSkeleton fields={6} />
        <RowsSkeleton rows={4} />
      </div>
    </SkeletonPage>
  )
}
