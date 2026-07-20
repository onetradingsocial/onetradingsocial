import type { Metadata } from 'next'
import Link from 'next/link'
import { CHANGELOG } from '@/lib/changelog'

export const metadata: Metadata = {
  title: 'Changelog — TradingSocial',
  description: 'What we shipped, when, and why. Feedback drives visible improvements.',
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

export default function ChangelogPage() {
  return (
    <main className="ts-page" style={{ maxWidth: 720 }}>
      <header className="lb-head"><div className="tx">
        <h1 className="ts-h1">Changelog</h1>
        <p>What we&apos;ve shipped and why. Have an idea?{' '}
          <Link href="/feature-board" style={{ color: 'var(--violet-br)', fontWeight: 700 }}>Suggest it on the feature board</Link>.</p>
      </div></header>

      <div className="mt-5" style={{ display: 'grid', gap: 18 }}>
        {CHANGELOG.map((e, i) => (
          <div key={i} className="ts-card">
            <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <h2 className="ts-h2" style={{ fontSize: 18 }}>{e.title}</h2>
              {e.version && <span className="v-badge">{e.version}</span>}
              <span className="faint" style={{ fontSize: 12.5, marginLeft: 'auto' }}>{fmt(e.date)}</span>
            </div>
            {e.why && <p className="ts-sub mt-2" style={{ fontStyle: 'italic' }}>{e.why}</p>}
            <ul className="mt-3" style={{ display: 'grid', gap: 6, paddingLeft: 18 }}>
              {e.what.map((w, j) => <li key={j} style={{ fontSize: 14, lineHeight: 1.5 }}>{w}</li>)}
            </ul>
          </div>
        ))}
      </div>

      <p className="faint mt-5" style={{ fontSize: 13 }}>
        Spotted a bug or want something changed? Use the Help button in the app, or the{' '}
        <Link href="/feature-board" style={{ color: 'var(--violet-br)' }}>feature board</Link>.
      </p>
    </main>
  )
}
