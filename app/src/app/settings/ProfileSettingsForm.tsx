'use client'

import { useActionState } from 'react'
import { saveProfileSettings } from '@/app/actions/profile'
import type { ProfileState } from '@/app/actions/profile'
import { AvatarUploader } from '@/app/_components/AvatarUploader'
import { useState } from 'react'
import { EXPERIENCE_LEVELS, MARKETS, TRADING_STYLES } from '@/lib/profile'
import { Icon } from '@/app/[username]/_components/Icon'
import { CUSTOM_BADGES } from '@/lib/badges'
import { THEME_PRESETS } from '@/lib/creator-profile'

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
  customBadge: string | null
  canCustomBadge: boolean
  canCreatorProfile: boolean
  themeColor: string | null
  tagline: string
  ctaLabel: string
  ctaUrl: string
  pinnedPostId: string | null
  ownPosts: { id: string; label: string }[]
}

export function ProfileSettingsForm(props: Props) {
  const [state, action, pending] = useActionState<ProfileState, FormData>(
    saveProfileSettings,
    {},
  )
  const saved = state?.ok === true
  const [customBadge, setCustomBadge] = useState(props.customBadge ?? '')
  const [themeColor, setThemeColor] = useState(props.themeColor ?? '')

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

          {/* Profile badge — Trader+ perk */}
          <div className="ts-field">
            <span className="ts-label">Profile badge</span>
            <input type="hidden" name="custom_badge" value={props.canCustomBadge ? customBadge : ''} />
            <div className="ts-chips">
              <label className="ts-chip">
                <input type="radio" checked={customBadge === ''} disabled={!props.canCustomBadge}
                  onChange={() => setCustomBadge('')} />
                None
              </label>
              {CUSTOM_BADGES.map((b) => (
                <label key={b.key} className="ts-chip">
                  <input type="radio" checked={customBadge === b.key} disabled={!props.canCustomBadge}
                    onChange={() => setCustomBadge(b.key)} />
                  <Icon name={b.icon} size={13} /> {b.label}
                </label>
              ))}
            </div>
            {!props.canCustomBadge && (
              <p className="settings-locknote">
                <Icon name="shield" size={14} />
                Custom badges are a Trader+ perk. <a href="/settings/billing">Upgrade</a> to pick your flair.
              </p>
            )}
          </div>

          {/* Creator-style profile — Pro perk */}
          <div id="creator-profile" className="ts-field">
            <span className="ts-label">Creator profile</span>
            <input type="hidden" name="theme_color" value={props.canCreatorProfile ? themeColor : ''} />

            <div className="ts-chips mb-3">
              <label className="ts-chip">
                <input type="radio" checked={themeColor === ''} disabled={!props.canCreatorProfile}
                  onChange={() => setThemeColor('')} />
                Default
              </label>
              {THEME_PRESETS.map((t) => (
                <label key={t.key} className="ts-chip">
                  <input type="radio" checked={themeColor === t.key} disabled={!props.canCreatorProfile}
                    onChange={() => setThemeColor(t.key)} />
                  {t.label}
                </label>
              ))}
            </div>

            <div className="ts-grid2">
              <label className="ts-field">
                <span className="ts-label">Tagline</span>
                <input name="tagline" className="ts-input" maxLength={80} disabled={!props.canCreatorProfile}
                  defaultValue={props.tagline} placeholder="Follow my daily setups" />
              </label>
              <label className="ts-field">
                <span className="ts-label">Pinned post</span>
                <select name="pinned_post_id" className="ts-select" disabled={!props.canCreatorProfile}
                  defaultValue={props.pinnedPostId ?? ''}>
                  <option value="">None</option>
                  {props.ownPosts.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </label>
            </div>

            <div className="ts-grid2">
              <label className="ts-field">
                <span className="ts-label">CTA button label</span>
                <input name="cta_label" className="ts-input" maxLength={24} disabled={!props.canCreatorProfile}
                  defaultValue={props.ctaLabel} placeholder="Join my Discord" />
              </label>
              <label className="ts-field">
                <span className="ts-label">CTA link</span>
                <input name="cta_url" type="url" className="ts-input" disabled={!props.canCreatorProfile}
                  defaultValue={props.ctaUrl} placeholder="https://…" />
              </label>
            </div>

            {!props.canCreatorProfile && (
              <p className="settings-locknote">
                <Icon name="shield" size={14} />
                Creator profile is a Pro perk. <a href="/settings/billing">Upgrade</a> for cover, theme, tagline, CTA &amp; pinned post.
              </p>
            )}
          </div>

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
