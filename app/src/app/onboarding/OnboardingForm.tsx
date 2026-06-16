'use client'

import { useActionState } from 'react'
import { saveOnboarding, type ProfileState } from '@/app/actions/profile'
import { EXPERIENCE_LEVELS, MARKETS, TRADING_STYLES } from '@/lib/profile'

const initial: ProfileState = {}

export function OnboardingForm({ initialUsername }: { initialUsername: string }) {
  const [state, action, pending] = useActionState(saveOnboarding, initial)
  return (
    <form action={action} className="mt-6 space-y-6">
      <div>
        <label className="block text-sm font-medium">Username</label>
        <input name="username" defaultValue={initialUsername} required
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

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button disabled={pending} className="w-full rounded bg-black py-2 font-medium text-white disabled:opacity-50">
        {pending ? 'Saving…' : 'Finish'}
      </button>
    </form>
  )
}
