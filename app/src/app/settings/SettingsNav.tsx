'use client'

import { useEffect, useState } from 'react'
import { Icon } from '@/app/[username]/_components/Icon'

const SECTIONS = [
  { id: 'profile', label: 'Profile', icon: 'users' },
  { id: 'trading', label: 'Trading account', icon: 'chart' },
  { id: 'privacy', label: 'Privacy', icon: 'shield' },
  { id: 'billing', label: 'Billing & plan', icon: 'scale' },
  { id: 'account', label: 'Account', icon: 'sliders' },
] as const

export function SettingsNav() {
  const [active, setActive] = useState<string>('profile')

  useEffect(() => {
    const els = SECTIONS
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => !!el)
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActive(visible[0].target.id)
      },
      { rootMargin: '-80px 0px -55% 0px', threshold: 0 },
    )
    els.forEach((el) => obs.observe(el))
    return () => obs.disconnect()
  }, [])

  return (
    <nav className="settings-nav" aria-label="Settings sections">
      {SECTIONS.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          className="settings-navlink"
          data-active={active === s.id}
          onClick={() => setActive(s.id)}
        >
          <Icon name={s.icon} size={17} />
          <span className="lab">{s.label}</span>
        </a>
      ))}
    </nav>
  )
}
