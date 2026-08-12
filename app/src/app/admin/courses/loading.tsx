import { Bone, FormSkeleton, HeadSkeleton, RowsSkeleton, SkeletonPage } from '../_components/Skeleton'

export default function Loading() {
  return (
    <SkeletonPage>
      <HeadSkeleton subLines={2} right={<Bone w={128} variant="pill" />} />
      <div style={{ display: 'grid', gap: 16 }}>
        <RowsSkeleton rows={5} />
        {/* NewCourseForm — a permanent second panel, 6 fields */}
        <FormSkeleton fields={6} />
      </div>
    </SkeletonPage>
  )
}
