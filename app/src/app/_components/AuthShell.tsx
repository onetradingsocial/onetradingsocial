import Link from 'next/link'

const POINTS = [
  {
    title: 'Trade journal',
    desc: 'Log every trade with notes, screenshots and the emotions behind it.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
  },
  {
    title: 'Verified track record',
    desc: 'Every stat on your profile is computed from trades you actually logged.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2 4 5v6c0 5 3.4 7.8 8 11 4.6-3.2 8-6 8-11V5l-8-3z" /><path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
  {
    title: 'Leaderboard',
    desc: 'Climb the ranks against disciplined traders around the world.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18" /><path d="m7 14 3-4 3 3 5-6" />
      </svg>
    ),
  },
]

export function AuthShell({
  mode,
  heading,
  sub,
  children,
}: {
  mode: 'login' | 'signup'
  heading: React.ReactNode
  sub: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="fl-stage">
      <div className="fl-card fl-auth">
        <aside className="fl-aside">
          <span className="fl-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <span className="mk"><img src="/logo.png" alt="" width={24} height={24} /></span>
            TradingSocial
          </span>

          <div className="fl-aside-eyebrow"><span className="pulse" /> Now in beta</div>
          <h2>Track. Prove. <span className="gr">Improve your trading.</span></h2>
          <p className="fl-aside-sub">
            Build a trading profile backed by real numbers — not screenshots. Journal your trades,
            prove your edge, and climb the leaderboard.
          </p>

          <div className="fl-points">
            {POINTS.map((p) => (
              <div className="fl-point" key={p.title}>
                <span className="p-ic">{p.icon}</span>
                <div>
                  <b>{p.title}</b>
                  <span>{p.desc}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="fl-proof">
            <div className="fl-proof-top">
              <span className="av" />
              <div className="who">
                <b>Built for traders</b>
                <span>Track · Prove · Improve</span>
              </div>
            </div>
            <p>Your win rate, P&amp;L and consistency are computed from the trades you log — tamper-proof and yours to own.</p>
            <div className="stars">★★★★★</div>
          </div>
        </aside>

        <div className="fl-form">
          <div className="fl-form-mark">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <span className="mk"><img src="/logo.png" alt="" width={22} height={22} /></span>
            TradingSocial
          </div>

          <div className="fl-tabs">
            <span className={`fl-thumb${mode === 'signup' ? ' right' : ''}`} />
            <Link href="/login" className={`fl-tab${mode === 'login' ? ' on' : ''}`}>Log in</Link>
            <Link href="/signup" className={`fl-tab${mode === 'signup' ? ' on' : ''}`}>Sign up</Link>
          </div>

          <div className="fl-head">
            <h1>{heading}</h1>
            <p>{sub}</p>
          </div>

          {children}
        </div>
      </div>
    </div>
  )
}

export function EyeIcon({ off }: { off?: boolean }) {
  return off ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <path d="M6.61 6.61A18.5 18.5 0 0 0 2 12s3 8 10 8a9.12 9.12 0 0 0 5.39-1.61" /><line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8z" /><circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}
