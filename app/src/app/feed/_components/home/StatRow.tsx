'use client'

import Link from 'next/link'
import { Icon, Sparkline } from './atoms'
import type { HomeData } from './types'

export function StatRow({ data }: { data: HomeData }) {
  const { metrics, viewerRank, totalRanked, tradeCount } = data
  const streak = metrics.currentStreak
  const stats = [
    { k: 'Overall Rank', v: viewerRank ? `#${viewerRank}` : '—', foot: viewerRank ? `of ${totalRanked} ranked` : 'log to rank', icon: 'trophy', accent: '#E0931E', accentSoft: 'var(--xp-soft)', seed: 3, trend: 2 },
    { k: 'Net P/L', v: `${metrics.netPnl >= 0 ? '+' : '−'}$${Math.abs(Math.round(metrics.netPnl)).toLocaleString()}`, foot: streak !== 0 ? `${Math.abs(streak)}-trade ${streak > 0 ? 'win' : 'loss'} streak` : 'flat', icon: 'trend', accent: metrics.netPnl >= 0 ? '#12A56B' : '#E5475D', accentSoft: metrics.netPnl >= 0 ? 'var(--up-soft)' : 'var(--down-soft)', seed: 9, trend: metrics.netPnl >= 0 ? 3 : -3 },
    { k: 'Win Rate', v: `${Math.round(metrics.winRate * 100)}%`, foot: `${metrics.total} closed`, icon: 'target', accent: '#7C5CE6', accentSoft: 'var(--grad-soft)', seed: 5, trend: 1 },
    { k: 'Avg R:R', v: metrics.avgRr ? metrics.avgRr.toFixed(1) : '—', foot: 'per closed trade', icon: 'scale', accent: '#3FB6E8', accentSoft: 'rgba(63,182,232,0.12)', seed: 12, trend: 2 },
    { k: 'Total Trades', v: String(tradeCount), foot: `${metrics.open} open`, icon: 'journal', accent: '#C840BC', accentSoft: 'rgba(200,64,188,0.10)', seed: 7, trend: 1 },
  ]
  return (
    <div>
      <div className="h-section-h" style={{ marginBottom: 12 }}>
        <h2>Your performance</h2>
        <Link className="h-link" href="/journal">Open journal <Icon name="chevR" size={13} /></Link>
      </div>
      <div className="h-stats">
        {stats.map((s, i) => (
          <div key={i} className="h-stat" style={{ '--accent': s.accent, '--accent-soft': s.accentSoft } as React.CSSProperties}>
            <div className="top">
              <span className="k">{s.k}</span>
              <span className="ic"><Icon name={s.icon} size={15} /></span>
            </div>
            <div className="v">{s.v}</div>
            <div className="foot"><span className="h-mono" style={{ fontSize: 11, color: 'var(--faint)' }}>{s.foot}</span></div>
            <div className="spark"><Sparkline seed={s.seed} trend={s.trend} color={s.accent} h={28} /></div>
          </div>
        ))}
      </div>
    </div>
  )
}
