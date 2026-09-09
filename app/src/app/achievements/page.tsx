import { redirect } from 'next/navigation'
import { createClient, getSessionUser } from '@/lib/supabase/server'
import { getUserXp } from '@/lib/server/xp'
import { getProcessLogs } from '@/lib/server/process'
import { entriesForDay } from '@/lib/process'
import { XP } from '@/lib/xp'
import { ProcessLogCard } from '@/app/_components/ProcessLogCard'
import { XpHero } from './_components/XpHero'
import { QuestList } from './_components/QuestList'
import { BadgeGrid } from './_components/BadgeGrid'

export default async function AchievementsPage() {
  const supabase = await createClient()
  const user = await getSessionUser(supabase)
  if (!user) redirect('/login')

  const xp = await getUserXp(supabase, user.id)
  const logs = await getProcessLogs(supabase, user.id)
  const todayKey = new Date().toISOString().slice(0, 10)

  return (
    <main className="ts-page" style={{ maxWidth: 820 }}>
      <header className="lb-head"><div className="tx">
        <h1 className="ts-h1">Achievements</h1>
        {/* This line used to read "Earn XP by logging and closing trades". It
            was an accurate description of a reward system that paid for volume;
            it is not what the product is for. Audit 2026-09-05, P0. */}
        <p>Earn XP for the work that makes you better — reviews, rule reflections, and the
          discipline to stay out. A week you traded nothing can still be a perfect week.</p>
      </div></header>

      <XpHero level={xp.level} totalXp={xp.totalXp} questStreak={xp.questStreak} />
      {/* Learn hidden for now — we are not financial advisors. Restore lessons-completed line when compliant. */}

      {/* The quests below are unreachable without this card, so it sits above
          them rather than only on /journal. */}
      <div className="mt-6">
        <ProcessLogCard today={entriesForDay(logs, todayKey)} compact />
      </div>

      <div className="ach-quest-cols mt-6">
        <QuestList title="Daily quests" quests={xp.daily} reward={XP.DAILY_QUEST_BONUS} />
        <QuestList title="Weekly quests" quests={xp.weekly} reward={XP.WEEKLY_QUEST_BONUS} />
      </div>

      <div className="mt-6"><BadgeGrid badges={xp.badges} /></div>
    </main>
  )
}
