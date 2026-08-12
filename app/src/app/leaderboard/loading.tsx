// Mirrors leaderboard/page.tsx. .lb-main already supplies gap: 22, so no
// ts-skel-stack here — it would override the flex column with a 14px grid.
import { SkelBlock, SkelCard, SkelHead, SkelLine } from '../_components/PageSkeleton'

function Seg({ w }: { w: string }) {
  return <span className="lb-seg" style={{ display: 'flex', alignItems: 'center' }}><SkelLine w={w} h={12} /></span>
}

export default function Loading() {
  return (
    <main className="ts-page ts-feed lb-app">
      <div className="ts-feed-main lb-main">
        <SkelHead />

        {/* LeaderboardTabs — a sunk segmented control, not a card */}
        <div className="lb-segs" style={{ marginBottom: 14 }}>
          <Seg w="86px" /><Seg w="34px" /><Seg w="70px" />
        </div>

        {/* LeaderboardControls — period segs plus two 42px selects */}
        <div className="lb-filters">
          <div className="lb-segs">
            <Seg w="44px" /><Seg w="52px" /><Seg w="58px" /><Seg w="60px" />
          </div>
          <SkelBlock h={42} w="168px" r={12} />
          <SkelBlock h={42} w="150px" r={12} />
        </div>

        {/* Top performers — .lb-podium is 1fr 1.18fr 1fr, bottom-aligned */}
        <section>
          <div className="lb-section-h">
            <SkelLine w="170px" h={20} />
            <SkelLine w="90px" h={12} />
          </div>
          <div className="lb-podium">
            <SkelBlock h={302} r={22} />
            <SkelBlock h={344} r={22} />
            <SkelBlock h={302} r={22} />
          </div>
        </section>

        {/* LeaderboardTable — panel head (pager + search) over a 9-column table */}
        <div className="lb-panel">
          <div className="lb-panel-h" style={{ flexWrap: 'wrap', rowGap: 10 }}>
            <SkelLine w="140px" h={20} />
            <div className="lb-toolbar">
              <SkelLine w="104px" h={14} />
              <SkelBlock h={38} w="230px" r={10} />
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="lb-table">
              <thead>
                <tr>{Array.from({ length: 9 }).map((_, i) => <th key={i}><SkelLine w={i === 1 ? '90px' : '54px'} h={10} /></th>)}</tr>
              </thead>
              <tbody>
                {Array.from({ length: 10 }).map((_, r) => (
                  <tr key={r}>
                    {Array.from({ length: 9 }).map((_, c) => (
                      <td key={c}><SkelLine w={c === 1 ? '62%' : '44px'} h={13} /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <aside className="ts-feed-side">
        <SkelCard lines={4} />
      </aside>
    </main>
  )
}
