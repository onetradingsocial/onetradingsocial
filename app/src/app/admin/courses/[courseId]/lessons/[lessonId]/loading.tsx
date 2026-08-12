import { Block, Bone, FormSkeleton, HeadSkeleton, SkeletonPage } from '@/app/admin/_components/Skeleton'

export default function Loading() {
  return (
    <SkeletonPage>
      {/* "← Back to course" link, above the header */}
      <div style={{ marginBottom: 10 }} aria-hidden><Bone w={120} /></div>
      <HeadSkeleton right={<Block h={32} w={104} r={10} />} />
      <div style={{ display: 'grid', gap: 16 }}>
        {/* LessonEditForm — minmax(200px) grid, then a rows={16} textarea */}
        <FormSkeleton fields={4} textarea min={200} textareaHeight={336} />
        {/* QuizEditor — a titled panel of stacked, bordered question blocks */}
        <div className="ad-panel" aria-hidden>
          <div className="ad-panel-head">
            <Bone w={64} variant="pill" />
            <span className="r"><Bone w={78} /></span>
          </div>
          <div className="ad-panel-body" style={{ gap: 12 }}>
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} style={{ display: 'grid', gap: 8, padding: 14, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface-2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <Bone w={22} />
                  <Block h={38} />
                </div>
                <Block h={34} />
                <Block h={34} />
                <Block h={34} />
                <Block h={30} w={128} r={9} />
              </div>
            ))}
            <Block h={34} w={140} r={10} />
          </div>
        </div>
      </div>
    </SkeletonPage>
  )
}
