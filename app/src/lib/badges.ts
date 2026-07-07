// Preset custom badges (Trader+ perk) — small curated set so profile flair
// stays visually consistent instead of free-text abuse.
export type CustomBadge = { key: string; label: string; icon: string; grad: string }

export const CUSTOM_BADGES: CustomBadge[] = [
  { key: 'bull', label: 'Bull', icon: 'trend', grad: 'linear-gradient(135deg,#12A56B,#3FB6E8)' },
  { key: 'sniper', label: 'Sniper', icon: 'target', grad: 'linear-gradient(135deg,#7C5CE6,#C840BC)' },
  { key: 'diamond', label: 'Diamond Hands', icon: 'shield', grad: 'linear-gradient(135deg,#3FB6E8,#1A86B8)' },
  { key: 'grinder', label: 'Grinder', icon: 'flame', grad: 'linear-gradient(135deg,#FF7A4D,#E0931E)' },
  { key: 'sharp', label: 'Sharp', icon: 'bolt', grad: 'linear-gradient(135deg,#FFE08A,#E3A92B)' },
  { key: 'veteran', label: 'Veteran', icon: 'medal', grad: 'linear-gradient(135deg,#8C97A8,#5B6577)' },
]

export function findCustomBadge(key: string | null | undefined): CustomBadge | null {
  if (!key) return null
  return CUSTOM_BADGES.find((b) => b.key === key) ?? null
}
