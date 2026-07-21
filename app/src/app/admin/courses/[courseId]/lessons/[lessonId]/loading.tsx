import { FormSkeleton, HeadSkeleton, SkeletonPage } from '@/app/admin/_components/Skeleton'

export default function Loading() {
  return (
    <SkeletonPage>
      <HeadSkeleton />
      <div style={{ display: 'grid', gap: 16 }}>
        <FormSkeleton fields={4} textarea />
        <FormSkeleton fields={2} />
      </div>
    </SkeletonPage>
  )
}
