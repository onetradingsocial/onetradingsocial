import type { FeedTabItem } from '../FeedTabs'
import type { Recommendation } from '@/lib/recommend'

export type HomeLeader = {
  rank: number
  userId: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  pnl: number
  winRate: number
  trades: number
}

export type HomeRecentTrade = {
  id: string
  instrument: string
  market: string
  label: string
  pnl: number | null
  status: string
}

export type HomeMetrics = {
  winRate: number
  avgRr: number
  netPnl: number
  total: number
  open: number
  currentStreak: number
}

export type HomeQuest = { id: string; label: string; current: number; target: number; done: boolean }

export type HomeData = {
  userId: string
  name: string
  handle: string
  selfAvatar: string | null
  level: number
  xp: number
  streak: number
  viewerRank: number | null
  totalRanked: number
  loggedToday: number
  tradeCount: number
  metrics: HomeMetrics
  weekLeaders: HomeLeader[]
  recentTrades: HomeRecentTrade[]
  quests: HomeQuest[]
  feedItems: FeedTabItem[]
  feedHasMore: boolean
  followingIds: string[]
  series: { equity: number[]; winRate: number[]; avgRr: number[]; count: number[] }
  advancedStats: boolean
  /** Personalised trader suggestions for the rail (row 35). */
  recommendations: Recommendation[]
}
