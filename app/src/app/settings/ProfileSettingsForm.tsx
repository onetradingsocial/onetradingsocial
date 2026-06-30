'use client'

import { useActionState } from 'react'
import { saveProfileSettings } from '@/app/actions/profile'
import type { ProfileState } from '@/app/actions/profile'
import { AvatarUploader } from '@/app/_components/AvatarUploader'
import { EXPERIENCE_LEVELS, MARKETS, TRADING_STYLES } from '@/lib/profile'
import { Icon } from '@/app/[username]/_components/Icon'

type Props = {
  avatarUrl: string | null
  username: string
  displayName: string
  bio: string
  goal: string
  experience: string
  markets: string[]
  styles: string[]
  isPublic: boolean
  canGoPrivate: boolean
}

export function ProfileSettingsForm(props: Props) {
  const [state, action, pending] = useActionState<ProfileState, FormData>(
    saveProfileSettings,
    {},
  )
  const saved = state?.ok === true

  return (
    <>
      <section id="profile" className="ts-card settings-section">
        <h2 className="ts-h2"><Icon name="users" size={18} /> Profile</h2>
        <p className="ts-sub mb-5">How you appear across TradingSocial.</p>

        <div className="mb-6">
          <AvatarUploader current={props.avatarUrl} />
        </div>

        <form action={action} className="grid gap-4">
          <div className="ts-grid2">
            <label className="ts-field">
              <span className="ts-label">Display name</span>
              <input name="display_name" className="ts-input"
                defaultValue={props.displayName} placeholder="Your name" />
            </label>
            <label className="ts-field">
              <span className="ts-label">Username</span>
              <input name="username" className="ts-input" required
                defaultValue={props.username} placeholder="username" />
            </label>
          </div>

          <label className="ts-field">
            <span className="ts-label">Bio</span>
            <textarea name="bio" className="ts-textarea" rows={3}
              defaultValue={props.bio} placeholder="A line about how you trade." />
          </label>

          <label className="ts-field" style={{ maxWidth: 260 }}>
            <span className="ts-label">Experience</span>
            <select name="experience_level" className="ts-select"
              defaultValue={props.experience || 'beginner'}>
              {EXPERIENCE_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>

          <div className="ts-field">
            <span className="ts-label">Main markets</span>
            <div className="ts-chips">
              {MARKETS.map((m) => (
                <label key={m} className="ts-chip">
                  <input type="checkbox" name="main_markets" value={m}
                    defaultChecked={props.markets.includes(m)} />
                  {m}
                </label>
              ))}
            </div>
          </div>

          <div className="ts-field">
            <span className="ts-label">Trading styles</span>
            <div className="ts-chips">
              {TRADING_STYLES.map((s) => (
                <label key={s} className="ts-chip">
                  <input type="checkbox" name="trading_styles" value={s}
                    defaultChecked={props.styles.includes(s)} />
                  {s}
                </label>
              ))}
            </div>
          </div>

          <label className="ts-field">
            <span className="ts-label">Goal</span>
            <textarea name="goal" className="ts-textarea" rows={2}
              defaultValue={props.goal} placeholder="What are you working toward?" />
          </label>

          {/* Privacy — folded into this form, anchored for the nav */}
          <div id="privacy" className="settings-privacy">
            <h2 className="ts-h2"><Icon name="shield" size={18} /> Privacy</h2>
            <p className="ts-sub mb-4">
              Public profiles appear on the leaderboard and can gain followers.
            </p>
            <div className="ts-seg">
              <label>
                <input type="radio" name="is_public" value="public"
                  defaultChecked={props.isPublic || !props.canGoPrivate} />
                Public
              </label>
              <label>
                <input type="radio" name="is_public" value="private"
                  defaultChecked={!props.isPublic} disabled={!props.canGoPrivate} />
                Private
              </label>
            </div>
            {!props.canGoPrivate && (
              <p className="settings-locknote">
                <Icon name="shield" size={14} />
                Private journaling is a paid perk. <a href="/settings/billing">Upgrade</a> to go solo.
              </p>
            )}
          </div>

          <div role="status" aria-live="polite">
            {state?.error && <p className="ts-error">{state.error}</p>}
          </div>

          <div className="settings-foot" aria-live="polite">
            <button className="btn btn-primary" disabled={pending}>
              {pending ? 'Saving…' : 'Save changes'}
            </button>
            {saved && <span className="settings-saved">Saved.</span>}
          </div>
        </form>
      </section>
    </>
  )
}
