// Creator-style profile (Pro perk): preset accent themes + CTA URL validation.
export type ThemePreset = { key: string; label: string; grad: string }

export const THEME_PRESETS: ThemePreset[] = [
  { key: 'violet', label: 'Violet', grad: 'linear-gradient(135deg,#7C5CE6,#C840BC)' },
  { key: 'ocean', label: 'Ocean', grad: 'linear-gradient(135deg,#3FB6E8,#1A86B8)' },
  { key: 'sunset', label: 'Sunset', grad: 'linear-gradient(135deg,#FF7A4D,#E0931E)' },
  { key: 'emerald', label: 'Emerald', grad: 'linear-gradient(135deg,#12A56B,#3FB6E8)' },
  { key: 'gold', label: 'Gold', grad: 'linear-gradient(135deg,#FFE08A,#E3A92B)' },
]

export function findTheme(key: string | null | undefined): ThemePreset | null {
  if (!key) return null
  return THEME_PRESETS.find((t) => t.key === key) ?? null
}

/** Only http(s) URLs allowed — blocks javascript:/data: etc in a user-supplied CTA link. */
export function sanitizeCtaUrl(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) return null
  try {
    const u = new URL(trimmed)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.toString()
  } catch {
    return null
  }
}
