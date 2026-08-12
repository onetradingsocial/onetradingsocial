import { Bone, HeadSkeleton, RowsSkeleton, SectionSkeleton, SkeletonPage } from '../_components/Skeleton'

const COUNT_BADGE = <Bone w={26} variant="pill" />

export default function Loading() {
  return (
    <SkeletonPage>
      <HeadSkeleton subLines={2} />
      <div className="ad-stack">
        <SectionSkeleton right={COUNT_BADGE}><RowsSkeleton rows={4} title={false} /></SectionSkeleton>
        <SectionSkeleton right={COUNT_BADGE}><RowsSkeleton rows={3} title={false} /></SectionSkeleton>
        <SectionSkeleton right={COUNT_BADGE}><RowsSkeleton rows={2} title={false} /></SectionSkeleton>
      </div>
    </SkeletonPage>
  )
}
