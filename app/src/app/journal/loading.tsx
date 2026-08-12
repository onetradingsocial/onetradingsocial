// Mirrors journal/page.tsx: a plain block-flow .ts-page (no skel-stack grid)
// whose children are spaced with the same mt-5 rhythm as the real page.
// Order matches the always-rendered blocks; the tier-gated cards between the
// stat row and the comparison card are omitted because they are conditional.
import { SkelBlock } from '../_components/PageSkeleton'

export default function Loading() {
  return (
    <main className="ts-page">
      {/* JournalHero — full-bleed gradient panel, not a .lb-head text block */}
      <SkelBlock h={180} r={22} />

      {/* StatCards — 5-up .ts-cards5 grid of .ts-bigcard tiles */}
      <div className="ts-cards5 mt-5">
        {Array.from({ length: 5 }).map((_, i) => <SkelBlock key={i} h={126} r={18} />)}
      </div>

      {/* Comparison / Streaks / Goals — ungated, always render */}
      <div className="mt-5"><SkelBlock h={214} r={22} /></div>
      <div className="mt-5"><SkelBlock h={214} r={22} /></div>
      <div className="mt-5"><SkelBlock h={214} r={22} /></div>

      {/* Monthly P/L · Equity Curve · Asset Distribution */}
      <div className="ts-panels mt-5">
        <SkelBlock h={286} r={22} />
        <SkelBlock h={286} r={22} />
        <SkelBlock h={286} r={22} />
      </div>

      {/* TradingCalendar */}
      <div className="mt-5"><SkelBlock h={430} r={22} /></div>

      {/* Export button row, right-aligned */}
      <div className="mt-5 flex items-center justify-end"><SkelBlock h={40} w="220px" r={12} /></div>

      {/* RecentTrades */}
      <div className="mt-3"><SkelBlock h={420} r={22} /></div>
    </main>
  )
}
