'use client'

import Link from 'next/link'
import { Icon, Sparkline } from './atoms'
import type { HomeData } from './types'

export function StatRow({ data }: { data: HomeData }) {
  const { metrics, viewerRank, totalRanked, tradeCount, series } = data
  const streak = metrics.currentStreak
  const stats = [
    { k: 'Overall Rank', v: viewerRank ? `#${viewerRank}` : '—', foot: viewerRank ? `of ${totalRanked} ranked` : 'log to rank', icon: 'trophy', accent: '#E0931E', values: series.equity },
    { k: 'Net P/L', v: `${metrics.netPnl >= 0 ? '+' : '−'}$${Math.abs(Math.round(metrics.netPnl)).toLocaleString()}`, foot: streak !== 0 ? `${Math.abs(streak)}-trade ${streak > 0 ? 'win' : 'loss'} streak` : 'flat', icon: 'trend', accent: metrics.netPnl >= 0 ? '#12A56B' : '#E5475D', values: series.equity },
    { k: 'Win Rate', v: `${Math.round(metrics.winRate * 100)}%`, foot: `${metrics.total} closed`, icon: 'target', accent: '#7C5CE6', values: series.winRate },
    { k: 'Avg R:R', v: metrics.avgRr ? metrics.avgRr.toFixed(1) : '—', foot: 'per closed trade', icon: 'scale', accent: '#3FB6E8', values: series.avgRr },
    { k: 'Total Trades', v: String(tradeCount), foot: `${metrics.open} open`, icon: 'journal', accent: '#C840BC', values: series.count },
  ]
  return (
    <div>
      <div className="h-section-h" style={{ marginBottom: 12 }}>
        <h2>Your performance</h2>
        <Link className="h-link" href="/journal">Open journal <Icon name="chevR" size={13} /></Link>
      </div>
      <div className="h-stats">
        {stats.map((s, i) => (
          <div key={i} className="h-stat" style={{ '--accent': s.accent } as React.CSSProperties}>
            <div className="top">
              <span className="k">{s.k}</span>
              <span className="ic"><Icon name={s.icon} size={15} /></span>
            </div>
            <div className="v">{s.v}</div>
            <div className="foot"><span className="h-mono" style={{ fontSize: 11, color: 'var(--faint)' }}>{s.foot}</span></div>
            <div className="spark"><Sparkline values={s.values} color={s.accent} h={28} /></div>
          </div>
        ))}
      </div>
    </div>
  )
}
