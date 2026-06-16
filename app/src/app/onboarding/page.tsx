import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { EXPERIENCE_LEVELS, MARKETS, TRADING_STYLES } from '@/lib/profile'
import { saveOnboarding } from '@/app/actions/profile'

export default async function OnboardingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase
    .from('profiles').select('username').eq('id', user.id).single()

  const boundSaveOnboarding = saveOnboarding.bind(null, {}) as unknown as (formData: FormData) => Promise<void>

  return (
    <main className="mx-auto max-w-lg p-8">
      <h1 className="text-2xl font-bold">Build your trader identity</h1>
      <form action={boundSaveOnboarding} className="mt-6 space-y-6">
        <div>
          <label className="block text-sm font-medium">Username</label>
          <input name="username" defaultValue={profile?.username ?? ''} required
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2" />
        </div>

        <fieldset>
          <legend className="text-sm font-medium">What do you trade?</legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {MARKETS.map((m) => (
              <label key={m} className="flex items-center gap-1 text-sm capitalize">
                <input type="checkbox" name="main_markets" value={m} /> {m}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label className="block text-sm font-medium">Experience level</label>
          <select name="experience_level" className="mt-1 w-full rounded border border-gray-300 px-3 py-2 capitalize">
            {EXPERIENCE_LEVELS.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>

        <fieldset>
          <legend className="text-sm font-medium">Trading style (optional)</legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {TRADING_STYLES.map((s) => (
              <label key={s} className="flex items-center gap-1 text-sm">
                <input type="checkbox" name="trading_styles" value={s} /> {s}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label className="block text-sm font-medium">What is your main goal?</label>
          <input name="goal" className="mt-1 w-full rounded border border-gray-300 px-3 py-2" />
        </div>

        <fieldset>
          <legend className="text-sm font-medium">Profile visibility</legend>
          <label className="mr-4 text-sm"><input type="radio" name="is_public" value="public" defaultChecked /> Public</label>
          <label className="text-sm"><input type="radio" name="is_public" value="private" /> Private</label>
        </fieldset>

        <button className="w-full rounded bg-black py-2 font-medium text-white">Finish</button>
      </form>
    </main>
  )
}
