// Nine sections, in the same order as analytics/page.tsx. Counts come from
// the fixed-length arrays in lib/server/funnel.ts (8 funnel steps, 8 lifecycle
// buckets, 8 adoption features) — only the conditional panels (onboarding step
// reach, top broken paths) are left out.
import {
  BarsSkeleton, Bone, HeadSkeleton, MetersSkeleton, RowsSkeleton, SectionSkeleton, SkeletonPage, StatsSkeleton,
} from '../_components/Skeleton'

export default function Loading() {
  return (
    <SkeletonPage>
      <HeadSkeleton wide subLines={3} right={<Bone w={132} variant="pill" />} />
      <div className="ad-stack">
        {/* 1 · Core funnel */}
        <SectionSkeleton><MetersSkeleton rows={8} title /></SectionSkeleton>
        {/* 2 · Lifecycle */}
        <SectionSkeleton><StatsSkeleton count={8} /></SectionSkeleton>
        {/* 3 · Acquisition */}
        <SectionSkeleton><RowsSkeleton rows={5} /></SectionSkeleton>
        {/* 4 · Feature adoption — untitled panel */}
        <SectionSkeleton><MetersSkeleton rows={8} /></SectionSkeleton>
        {/* 5 · Errors */}
        <SectionSkeleton><StatsSkeleton count={2} /></SectionSkeleton>
        {/* 6 · Growth */}
        <SectionSkeleton>
          <StatsSkeleton count={3} />
          <BarsSkeleton />
        </SectionSkeleton>
        {/* 7 · Engagement */}
        <SectionSkeleton>
          <StatsSkeleton count={3} />
          <BarsSkeleton />
          <BarsSkeleton />
          <BarsSkeleton />
        </SectionSkeleton>
        {/* 8 · Content */}
        <SectionSkeleton>
          <StatsSkeleton count={3} />
          <BarsSkeleton />
          <MetersSkeleton rows={4} title />
        </SectionSkeleton>
        {/* 9 · Ops */}
        <SectionSkeleton>
          <StatsSkeleton count={4} />
          <BarsSkeleton />
        </SectionSkeleton>
      </div>
    </SkeletonPage>
  )
}
