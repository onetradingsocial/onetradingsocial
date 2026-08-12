// Mirrors settings/page.tsx: .settings-page container over a .settings-head,
// then the .settings-grid (220px sticky nav / 1fr body, settings.css:12-17)
// holding the profile form plus 8 stacked .ts-card sections.
import './settings.css'
import { SkelBlock } from '@/app/_components/PageSkeleton'

export default function Loading() {
  return (
    <div className="settings-page" aria-busy="true" aria-label="Loading">
      <div className="settings-head" aria-hidden>
        <SkelBlock h={11} w="70px" r={5} />
        <div className="mt-3"><SkelBlock h={30} w="160px" r={8} /></div>
        <div style={{ marginTop: 6 }}><SkelBlock h={15} w="120px" r={7} /></div>
      </div>

      <div className="settings-grid" aria-hidden>
        <div style={{ display: 'grid', gap: 4 }}>
          {Array.from({ length: 6 }).map((_, i) => <SkelBlock key={i} h={38} r={10} />)}
        </div>
        <div className="settings-body">
          {/* ProfileSettingsForm, then 8 further cards (cover, trading,
              billing, account, broker, exchange, notifications, danger) */}
          <SkelBlock h={430} r={16} />
          {[210, 250, 190, 230, 220, 210, 240, 150].map((h, i) => (
            <SkelBlock key={i} h={h} r={16} />
          ))}
        </div>
      </div>
    </div>
  )
}
