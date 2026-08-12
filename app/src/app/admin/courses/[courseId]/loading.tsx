import { Block, Bone, FormSkeleton, HeadSkeleton, RowsSkeleton, SkeletonPage } from '../../_components/Skeleton'

export default function Loading() {
  return (
    <SkeletonPage>
      {/* "← All courses" back link, above the header */}
      <div style={{ marginBottom: 10 }} aria-hidden><Bone w={104} /></div>
      <HeadSkeleton right={<Block h={32} w={104} r={10} />} />
      <div style={{ display: 'grid', gap: 16 }}>
        <FormSkeleton fields={6} />
        <RowsSkeleton rows={4} />
      </div>
    </SkeletonPage>
  )
}
