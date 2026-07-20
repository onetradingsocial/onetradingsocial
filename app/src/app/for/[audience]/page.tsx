import type { Metadata } from 'next'
import Link from 'next/link'
import Script from 'next/script'
import { notFound } from 'next/navigation'
import { LANDINGS } from '@/lib/landing'

export const dynamicParams = false

export function generateStaticParams() {
  return Object.keys(LANDINGS).map((audience) => ({ audience }))
}

export async function generateMetadata({ params }: { params: Promise<{ audience: string }> }): Promise<Metadata> {
  const { audience } = await params
  const l = LANDINGS[audience]
  if (!l) return {}
  return {
    title: `${l.headline} — TradingSocial`,
    description: l.sub,
    alternates: { canonical: `/for/${l.slug}` },
    openGraph: { title: l.headline, description: l.sub },
  }
}

export default async function LandingPage({ params }: { params: Promise<{ audience: string }> }) {
  const { audience } = await params
  const l = LANDINGS[audience]
  if (!l) notFound()

  // ?ref=/utm_source are captured by middleware and follow the user into signup.
  return (
    <main className="ts-page" style={{ maxWidth: 900 }}>
      <section style={{ textAlign: 'center', padding: '40px 16px 20px' }}>
        <span className="eyebrow" style={{ justifyContent: 'center', display: 'inline-flex' }}>{l.eyebrow}</span>
        <h1 className="ts-h1" style={{ fontSize: 40, margin: '12px 0' }}>{l.headline}</h1>
        <p className="lead" style={{ maxWidth: 620, margin: '0 auto', color: 'var(--dim)', fontSize: 18, lineHeight: 1.6 }}>{l.sub}</p>
        <div style={{ marginTop: 24, display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/signup" className="btn btn-primary">{l.cta}</Link>
          <Link href="/demo" className="btn">See a demo journal</Link>
        </div>
      </section>

      <section className="ts-grid3 mt-5">
        {l.points.map((p) => (
          <div key={p.title} className="ts-card">
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 17, marginBottom: 6 }}>{p.title}</h3>
            <p className="faint" style={{ fontSize: 14, lineHeight: 1.55 }}>{p.body}</p>
          </div>
        ))}
      </section>

      <section className="ts-card mt-5" style={{ textAlign: 'center', padding: '26px 20px' }}>
        <div id="landing-proof" style={{ fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 700 }}>—</div>
        <div className="faint" style={{ fontSize: 14 }}>{l.proof}</div>
        <div style={{ marginTop: 16 }}>
          <Link href="/signup" className="btn btn-primary">{l.cta}</Link>
        </div>
      </section>

      {/* Static, no user input: fills the proof count from the live stats API. */}
      <Script id="landing-proof-fill" strategy="afterInteractive">{`
        fetch('/api/stats').then(function(r){return r.ok?r.json():null}).then(function(d){
          if(!d) return; var el=document.getElementById('landing-proof');
          if(el) el.textContent = (d.tradesJournaled||0).toLocaleString();
        }).catch(function(){});
      `}</Script>
    </main>
  )
}
