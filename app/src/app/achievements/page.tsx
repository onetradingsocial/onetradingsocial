import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserXp } from '@/lib/server/xp'
import { XP } from '@/lib/xp'
import { XpHero } from './_components/XpHero'
import { QuestList } from './_components/QuestList'
import { BadgeGrid } from './_components/BadgeGrid'

export default async function AchievementsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const xp = await getUserXp(supabase, user.id)

  return (
    <main className="ts-page" style={{ maxWidth: 820 }}>
      <header className="lb-head"><div className="tx">
        <h1 className="ts-h1">Achievements</h1>
        <p>Earn XP by logging and closing trades, complete daily &amp; weekly quests, and unlock milestone badges.</p>
      </div></header>

      <XpHero level={xp.level} totalXp={xp.totalXp} questStreak={xp.questStreak} />
      <p className="faint mt-3" style={{ fontSize: 13 }}>📚 {xp.lessonsCompleted} lesson{xp.lessonsCompleted === 1 ? '' : 's'} completed · <Link href="/learn" className="ts-link-sm">Learn</Link></p>

      <div className="ach-quest-cols mt-6">
        <QuestList title="Daily quests" quests={xp.daily} reward={XP.DAILY_QUEST_BONUS} />
        <QuestList title="Weekly quests" quests={xp.weekly} reward={XP.WEEKLY_QUEST_BONUS} />
      </div>

      <div className="mt-6"><BadgeGrid badges={xp.badges} /></div>
    </main>
  )
}
