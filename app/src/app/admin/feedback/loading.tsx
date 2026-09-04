// PageHead's right slot is a 4-tab .adm-tabs nav, and the rows are
// .adm-row-stack (meta line + wrapped message), not flat single-line rows.
import { Bone, HeadSkeleton, RowsSkeleton, SkeletonPage, TabsSkeleton } from '../_components/Skeleton'

export default function Loading() {
  return (
    <SkeletonPage>
      <HeadSkeleton subLines={2} right={<TabsSkeleton count={4} />} />
      <div style={{ display: 'grid', gap: 14 }}>
        <div className="adm-note" aria-hidden>
          <Bone w={58} />
          <Bone w={92} variant="pill" />
          <Bone w={78} variant="pill" />
          <Bone w={104} variant="pill" />
        </div>
        <RowsSkeleton rows={8} stacked />
      </div>
    </SkeletonPage>
  )
}
