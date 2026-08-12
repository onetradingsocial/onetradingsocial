// One titled panel per GROUPS entry in features/page.tsx, with that group's
// row count and FlagMatrix's fixed column widths. The optional "Other" group
// is left out — it only appears when a feature key escapes every group.
import { Bone, HeadSkeleton, SkeletonPage, TableSkeleton } from '../_components/Skeleton'

const COLS: (number | undefined)[] = [undefined, 76, 76, 76, 90]
const GROUP_ROWS = [4, 10, 6, 4, 3, 2]

export default function Loading() {
  return (
    <SkeletonPage>
      <HeadSkeleton wide subLines={3} right={<Bone w={128} variant="pill" />} />
      <div style={{ display: 'grid', gap: 14 }}>
        {GROUP_ROWS.map((rows, i) => (
          <TableSkeleton key={i} rows={rows} cols={5} title scroll={false} widths={COLS} />
        ))}
      </div>
    </SkeletonPage>
  )
}
