'use client'

import { useActionState } from 'react'
import { saveOnboarding, type ProfileState } from '@/app/actions/profile'
import { EXPERIENCE_LEVELS, MARKETS, TRADING_STYLES } from '@/lib/profile'

const initial: ProfileState = {}

export function OnboardingForm({ initialUsername }: { initialUsername: string }) {
  const [state, action, pending] = useActionState(saveOnboarding, initial)
  return (
    <form action={action} className="mt-7 grid gap-7">
      <label className="ts-field">
        <span className="ts-label">Username</span>
        <input name="username" defaultValue={initialUsername} required className="ts-input" placeholder="yourname" />
      </label>

      <fieldset>
        <legend className="ts-label">What do you trade?</legend>
        <div className="ts-chips">
          {MARKETS.map((m) => (
            <label key={m} className="ts-chip">
              <input type="checkbox" name="main_markets" value={m} /> {m}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="ts-field">
        <span className="ts-label">Experience level</span>
        <select name="experience_level" className="ts-select" defaultValue="beginner">
          {EXPERIENCE_LEVELS.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
      </label>

      <fieldset>
        <legend className="ts-label">Trading style <span className="faint">(optional)</span></legend>
        <div className="ts-chips">
          {TRADING_STYLES.map((s) => (
            <label key={s} className="ts-chip">
              <input type="checkbox" name="trading_styles" value={s} /> {s}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="ts-field">
        <span className="ts-label">What is your main goal?</span>
        <input name="goal" className="ts-input" placeholder="e.g. Become consistently profitable" />
      </label>

      <fieldset>
        <legend className="ts-label">Profile visibility</legend>
        <div className="ts-seg">
          <label><input type="radio" name="is_public" value="public" defaultChecked /> Public</label>
          <label><input type="radio" name="is_public" value="private" /> Private</label>
        </div>
      </fieldset>

      {state.error && <p className="ts-error">{state.error}</p>}
      <button disabled={pending} className="btn btn-primary btn-block">
        {pending ? 'Saving…' : 'Finish setup'}
      </button>
    </form>
  )
}
