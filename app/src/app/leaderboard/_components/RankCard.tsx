export function RankCard({ rank, total }: { rank: number | null; total: number }) {
  const topPct = rank && total ? Math.max(1, Math.round((rank / total) * 100)) : null
  return (
    <div className="ts-totw ts-rankcard">
      <div className="ts-totw-glow" />
      <div className="ts-totw-body">
        <p className="eyebrow" style={{ color: 'rgba(255,255,255,0.85)' }}>Your rank · all-time</p>
        {rank
          ? <><div className="ts-rankcard-rank">#{rank}</div><div className="ts-rankcard-sub">top {topPct}% of {total} traders</div></>
          : <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 8 }}>Log public closed trades to earn a rank.</p>}
      </div>
    </div>
  )
}
