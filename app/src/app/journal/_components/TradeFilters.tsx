import Link from 'next/link'

const TABS = [['all', 'All'], ['open', 'Open'], ['closed', 'Closed']] as const

export function TradeFilters({ active }: { active: string }) {
  return (
    <div className="ts-filterbar">
      {TABS.map(([key, label]) => (
        <Link key={key} href={key === 'all' ? '/journal' : `/journal?filter=${key}`} data-active={active === key}>
          {label}
        </Link>
      ))}
    </div>
  )
}
