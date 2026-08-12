// The panel carries a title ("Last N actions") and the query pulls up to 200
// rows, so the skeleton fills roughly a viewport rather than 10 rows.
import { Bone, HeadSkeleton, SkeletonPage, TableSkeleton } from '../_components/Skeleton'

export default function Loading() {
  return (
    <SkeletonPage>
      <HeadSkeleton subLines={2} right={<Bone w={96} variant="pill" />} />
      <TableSkeleton rows={18} cols={5} title />
    </SkeletonPage>
  )
}
