import Link from 'next/link'
import { NotFoundTracker } from './_components/NotFoundTracker'

export default function NotFound() {
  return (
    <main style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', padding: '48px 20px' }}>
      <NotFoundTracker />
      <div style={{ textAlign: 'center', maxWidth: 440 }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 13, letterSpacing: 2, opacity: 0.6, marginBottom: 8 }}>404</p>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, marginBottom: 10 }}>Page not found</h1>
        <p style={{ opacity: 0.7, marginBottom: 24 }}>
          The page you&apos;re after moved or never existed. It&apos;s been logged so we can fix any broken links.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <Link href="/" className="btn btn-primary">Go home</Link>
          <Link href="/journal" className="btn">Open journal</Link>
        </div>
      </div>
    </main>
  )
}
