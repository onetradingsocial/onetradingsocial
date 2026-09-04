import { Bone, HeadSkeleton, SectionSkeleton, SkeletonPage, TableSkeleton } from '../_components/Skeleton'

export default function Loading() {
  return (
    <SkeletonPage>
      <HeadSkeleton subLines={2} right={<Bone w={132} variant="pill" />} />
      <div className="adm-stack">
        {/* Weekly signup cohorts — <Panel flush scroll> with no title */}
        <SectionSkeleton><TableSkeleton rows={6} cols={5} /></SectionSkeleton>
        {/* Breakdowns — four titled BreakdownTable panels */}
        <SectionSkeleton>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
            <TableSkeleton rows={3} cols={5} title />
            <TableSkeleton rows={3} cols={5} title />
            <TableSkeleton rows={3} cols={5} title />
            <TableSkeleton rows={3} cols={5} title />
          </div>
        </SectionSkeleton>
      </div>
    </SkeletonPage>
  )
}
