'use client'

import { useState, useMemo, useRef, useActionState, type ReactNode } from 'react'
import { saveOnboarding, type ProfileState } from '@/app/actions/profile'

/* ───────────────── icons (subset of the home design system) ───────────────── */
const IP = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
type IconName =
  | 'check' | 'chart' | 'trophy' | 'users' | 'arrowRight' | 'chevR'
  | 'target' | 'shield' | 'bolt' | 'book' | 'trend' | 'scale' | 'flag' | 'globe' | 'crown' | 'sparkle'

const ICONS: Record<IconName, ReactNode> = {
  check: <path d="M20 6L9 17l-5-5" {...IP} strokeWidth={2.4} />,
  chart: <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" {...IP} />,
  trophy: <g {...IP}><path d="M8 21h8M12 17v4M6 4h12v5a6 6 0 01-12 0V4z" /><path d="M6 6H3v2a3 3 0 003 3M18 6h3v2a3 3 0 01-3 3" /></g>,
  users: <g {...IP}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0111 0M16 6.5a3 3 0 010 5.6M19 19a5 5 0 00-3.5-4.8" /></g>,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" {...IP} />,
  chevR: <path d="M9 6l6 6-6 6" {...IP} />,
  target: <g {...IP}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /></g>,
  shield: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" {...IP} />,
  bolt: <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" fill="currentColor" stroke="none" />,
  book: <path d="M12 4L2 9l10 5 10-5-10-5zM6 11v5c0 1 2.7 2.5 6 2.5s6-1.5 6-2.5v-5" {...IP} />,
  trend: <g {...IP}><path d="M3 17l5-5 4 3 8-9" /><path d="M16 6h5v5" /></g>,
  scale: <g {...IP}><path d="M12 3v18M5 7h14M7 7l-3 6a3 3 0 006 0L7 7zM17 7l-3 6a3 3 0 006 0l-3-6z" /></g>,
  flag: <g {...IP}><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></g>,
  globe: <g {...IP}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" /></g>,
  crown: <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-1.5 11h-15L3 8z" {...IP} />,
  sparkle: <path d="M12 2l2.2 6.3L21 10.5l-6.8 2.2L12 19l-2.2-6.3L3 10.5l6.8-2.2L12 2z" fill="currentColor" stroke="none" />,
}
function Icon({ name, size = 18, style }: { name: IconName; size?: number; style?: React.CSSProperties }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} style={style}>{ICONS[name]}</svg>
}

/* ───────────────── identity data ───────────────── */
// Market ids match MARKETS in @/lib/profile; level ids match EXPERIENCE_LEVELS.
const OB_MARKETS = [
  { id: 'forex',       code: 'FX',  name: 'Forex',       sub: 'Major & minor pairs', color: '#3FB6E8' },
  { id: 'crypto',      code: 'BTC', name: 'Crypto',      sub: 'Coins & perps',       color: '#FF7A4D' },
  { id: 'stocks',      code: 'EQ',  name: 'Stocks',      sub: 'Equities & ETFs',     color: '#7C5CE6' },
  { id: 'indices',     code: 'IDX', name: 'Indices',     sub: 'US30, NAS100, SPX',   color: '#C840BC' },
  { id: 'commodities', code: 'XAU', name: 'Commodities', sub: 'Gold, oil & metals',  color: '#E0931E' },
]

const OB_LEVELS = [
  { id: 'beginner',     bars: 'b1', title: 'Beginner',     yrs: '< 1 yr',  desc: 'Learning the ropes — charts, risk and the basics.', rank: 'Rookie' },
  { id: 'intermediate', bars: 'b2', title: 'Intermediate', yrs: '1–3 yrs', desc: 'Have a strategy, working on consistency.',          rank: 'Strategist' },
  { id: 'advanced',     bars: 'b3', title: 'Advanced',     yrs: '3+ yrs',  desc: 'Refining a proven edge and managing size.',        rank: 'Veteran' },
] as const

const OB_GOALS: { id: string; icon: IconName; title: string; desc: string }[] = [
  { id: 'consistency', icon: 'target', title: 'Build consistency', desc: 'Turn good weeks into a repeatable process.' },
  { id: 'funded',      icon: 'shield', title: 'Pass a funded challenge', desc: 'Hit targets, respect the drawdown rules.' },
  { id: 'fulltime',    icon: 'bolt',   title: 'Go full-time',      desc: 'Make trading my primary income.' },
  { id: 'learn',       icon: 'book',   title: 'Learn the fundamentals', desc: 'Master setups, risk and psychology.' },
  { id: 'grow',        icon: 'trend',  title: 'Grow my account',   desc: 'Compound steadily, month over month.' },
  { id: 'audience',    icon: 'users',  title: 'Share my journey',  desc: 'Build a following and trade in public.' },
]

const OB_VIS: { id: string; icon: IconName; title: string; desc: string; tags: string[] }[] = [
  { id: 'public',  icon: 'globe',  title: 'Public',  desc: 'Share trades, climb the leaderboard and gain followers.', tags: ['Leaderboard', 'Followers', 'Copy-trades'] },
  { id: 'private', icon: 'shield', title: 'Private', desc: 'Journal solo. Your stats stay between you and your charts.', tags: ['Solo journal', 'Hidden stats'] },
]

type Data = { markets: string[]; level: string; goal: string; visibility: string }

/* ───────────────── small helpers ───────────────── */
function Dots({ step, total }: { step: number; total: number }) {
  return (
    <div className="ob-dots">
      {Array.from({ length: total }).map((_, i) => (
        <i key={i} className={i === step ? 'on' : i < step ? 'done' : ''} />
      ))}
    </div>
  )
}

function Row({ icon, k, value, empty, filled }: { icon: IconName; k: string; value?: ReactNode; empty: string; filled: boolean }) {
  return (
    <div className={'ob-idrow' + (filled ? ' filled' : '')}>
      <span className="r-ic"><Icon name={icon} size={15} /></span>
      <div className="r-tx">
        <div className="k">{k}</div>
        {filled ? <div className="v ob-pop">{value}</div> : <div className="v empty">{empty}</div>}
      </div>
    </div>
  )
}

/* ───────────────── live identity card (right pane) ───────────────── */
function IdentityCard({ data, xp, name, username }: { data: Data; xp: number; name: string; username: string }) {
  const lvl = OB_LEVELS.find((l) => l.id === data.level)
  const goal = OB_GOALS.find((g) => g.id === data.goal)
  const vis = OB_VIS.find((v) => v.id === data.visibility)
  const title = lvl ? lvl.rank + ' Trader' : 'Unranked Trader'
  const pickedMarkets = OB_MARKETS.filter((m) => data.markets.includes(m.id))

  return (
    <div className="ob-right">
      <div className="ob-grid-tex" />
      <div className="ob-right-eyebrow"><span className="pulse" /> Live preview · Your card</div>

      <div className="ob-idcard">
        <div className="ob-idtop">
          <div className="ob-idav">
            <span className="ring"><span style={{ width: 58, height: 58, background: 'linear-gradient(135deg,#7C5CE6,#C840BC)' }} /></span>
            <span className="lvbadge">LV1</span>
          </div>
          <div>
            <div className="ob-idname">{name} <span className="ob-verified" title="New member"><Icon name="check" size={12} /></span></div>
            <div className="ob-idhandle">@{username || 'yourname'}</div>
            <div className="ob-idtitle"><Icon name="crown" size={13} /> {title}</div>
          </div>
        </div>

        <div className="ob-idxp">
          <div className="xprow"><b>Level 1</b><span>{xp} / 100 XP</span></div>
          <div className="track"><i style={{ width: Math.min(100, xp) + '%' }} /></div>
        </div>

        <div className="ob-idrows">
          <Row
            icon="chart" k="Markets" filled={pickedMarkets.length > 0}
            empty="Pick what you trade"
            value={pickedMarkets.length > 0 && (
              <div className="ob-mkchips">
                {pickedMarkets.map((m) => <span key={m.id} style={{ background: m.color }}>{m.code}</span>)}
              </div>
            )}
          />
          <Row icon="scale" k="Experience" filled={!!lvl} empty="Set your level"
            value={lvl && <>{lvl.title} <span style={{ color: 'var(--on-ink-dim)', fontWeight: 500 }}>· {lvl.yrs}</span></>} />
          <Row icon="flag" k="Main goal" filled={!!goal} empty="Choose a goal"
            value={goal && goal.title} />
          <Row icon={vis ? vis.icon : 'globe'} k="Profile" filled={!!vis} empty="Public or private"
            value={vis && vis.title + ' profile'} />
        </div>
      </div>

      <div className="ob-right-foot"><Icon name="check" size={15} /> This becomes your public trader card.</div>
    </div>
  )
}

/* ───────────────── step shell ───────────────── */
function StepShell(props: {
  step: number; total: number; stepLabel: string; q: string; sub: string; children: ReactNode
  onBack: () => void; onNext: () => void; nextLabel?: string; nextDisabled?: boolean
  data: Data; xp: number; name: string; username: string
}) {
  return (
    <div className="ob-grid">
      <div className="ob-left">
        <div className="ob-left-head ob-anim" key={'h' + props.step}>
          <div className="ob-step-meta">
            <span className="ob-stepnum">{props.stepLabel}</span>
            <Dots step={props.step - 1} total={props.total} />
          </div>
          <div className="ob-q">{props.q}</div>
          <div className="ob-sub">{props.sub}</div>
        </div>
        <div className="ob-body ob-anim" key={'b' + props.step}>{props.children}</div>
        <div className="ob-foot">
          <button type="button" className="ob-back" onClick={props.onBack}><Icon name="chevR" size={16} style={{ transform: 'rotate(180deg)' }} /> Back</button>
          <div className="ob-spacer" />
          <button type="button" className="ob-next" onClick={props.onNext} disabled={props.nextDisabled}>
            {props.nextLabel || 'Continue'} <Icon name="arrowRight" size={17} />
          </button>
        </div>
      </div>
      <IdentityCard data={props.data} xp={props.xp} name={props.name} username={props.username} />
    </div>
  )
}

const initial: ProfileState = {}

export function OnboardingForm({ initialUsername, displayName }: { initialUsername: string; displayName?: string }) {
  const [step, setStep] = useState(0) // 0 welcome, 1..4 questions, 5 reveal
  const [data, setData] = useState<Data>({ markets: [], level: '', goal: '', visibility: '' })
  const [username, setUsername] = useState(initialUsername)
  const [state, action, pending] = useActionState(saveOnboarding, initial)
  const formRef = useRef<HTMLFormElement>(null)

  const name = displayName?.trim() || username.trim() || 'trader'
  const usernameReady = username.trim().length >= 3

  // XP grows as the identity fills in — reinforces "building"
  const xp = useMemo(() => {
    let x = 10
    if (data.markets.length) x += 25
    if (data.level) x += 25
    if (data.goal) x += 25
    if (data.visibility) x += 15
    return x
  }, [data])

  const toggleMarket = (id: string) =>
    setData((d) => ({ ...d, markets: d.markets.includes(id) ? d.markets.filter((m) => m !== id) : [...d.markets, id] }))

  const go = (n: number) => setStep(n)

  const lvl = OB_LEVELS.find((l) => l.id === data.level)
  const goal = OB_GOALS.find((g) => g.id === data.goal)
  const vis = OB_VIS.find((v) => v.id === data.visibility)

  // hidden form mirrors the saveOnboarding FormData contract
  const hiddenForm = (
    <form ref={formRef} action={action} style={{ display: 'none' }}>
      <input type="hidden" name="username" value={username} />
      <input type="hidden" name="experience_level" value={data.level || 'beginner'} />
      {data.markets.map((m) => <input key={m} type="hidden" name="main_markets" value={m} />)}
      <input type="hidden" name="goal" value={goal?.title ?? ''} />
      <input type="hidden" name="is_public" value={data.visibility === 'public' ? 'public' : 'private'} />
    </form>
  )

  const submit = () => formRef.current?.requestSubmit()

  /* ---------- WELCOME ---------- */
  if (step === 0) {
    return (
      <div className="ob-card">
        {hiddenForm}
        <div className="ob-hero">
          <div className="ob-grid-tex" />
          <div className="ob-hero-mark"><img src="/logo.png" alt="" /></div>
          <div className="ob-hero-badge"><Icon name="check" size={14} /> Account created</div>
          <h1>Welcome, {name}. Let&apos;s build your <span className="gr">trader identity</span>.</h1>
          <p>You&apos;re in. Before you hit the charts, four quick questions shape your profile, your card and the traders you&apos;ll meet.</p>
          <div className="ob-perks">
            <div className="ob-perk"><div className="p-ic"><Icon name="chart" size={19} /></div><b>Your markets</b><span>A feed tuned to what you trade</span></div>
            <div className="ob-perk"><div className="p-ic"><Icon name="trophy" size={19} /></div><b>Your rank</b><span>Climb the global leaderboard</span></div>
            <div className="ob-perk"><div className="p-ic"><Icon name="users" size={19} /></div><b>Your circle</b><span>Traders who match your style</span></div>
          </div>
          <div className="ob-handle">
            <label className="ob-handle-label" htmlFor="ob-username">Choose your handle</label>
            <div className="ob-handle-input">
              <span className="at">@</span>
              <input
                id="ob-username" value={username} onChange={(e) => setUsername(e.target.value)}
                placeholder="yourname" autoComplete="off" maxLength={20} spellCheck={false}
              />
            </div>
          </div>
          <div className="ob-hero-cta">
            <button type="button" className="ob-next" onClick={() => go(1)} disabled={!usernameReady}>Build my identity <Icon name="arrowRight" size={17} /></button>
            <div className="ob-hero-meta"><span>Takes about 30 seconds</span><span className="dot" /><span>4 questions</span><span className="dot" /><span>+90 XP</span></div>
          </div>
        </div>
      </div>
    )
  }

  /* ---------- Q1 · MARKETS ---------- */
  if (step === 1) {
    return (
      <div className="ob-card">
        {hiddenForm}
        <div className="ob-progress-top"><i style={{ width: '25%' }} /></div>
        <StepShell
          step={1} total={4} stepLabel="Step 1 of 4" data={data} xp={xp} name={name} username={username}
          q="What do you trade?" sub="Pick every market you're active in. We'll tune your feed and match you with traders who run the same instruments."
          onBack={() => go(0)} onNext={() => go(2)} nextDisabled={data.markets.length === 0}
        >
          <div className="ob-markets">
            {OB_MARKETS.map((m) => (
              <button type="button" key={m.id} className={'ob-market' + (data.markets.includes(m.id) ? ' on' : '')} onClick={() => toggleMarket(m.id)}>
                <span className="mk-ic" style={{ background: `linear-gradient(135deg, ${m.color}, ${m.color}cc)` }}>{m.code}</span>
                <span className="mk-tx"><b>{m.name}</b><span>{m.sub}</span></span>
                <span className="mk-check"><Icon name="check" size={12} /></span>
              </button>
            ))}
          </div>
        </StepShell>
      </div>
    )
  }

  /* ---------- Q2 · EXPERIENCE ---------- */
  if (step === 2) {
    return (
      <div className="ob-card">
        {hiddenForm}
        <div className="ob-progress-top"><i style={{ width: '50%' }} /></div>
        <StepShell
          step={2} total={4} stepLabel="Step 2 of 4" data={data} xp={xp} name={name} username={username}
          q="What's your experience level?" sub="This sets your starting rank and the depth of insight we surface. You can always level up as you log trades."
          onBack={() => go(1)} onNext={() => go(3)} nextDisabled={!data.level}
        >
          <div className="ob-levels">
            {OB_LEVELS.map((l) => (
              <button type="button" key={l.id} className={'ob-lvl ' + l.bars + (data.level === l.id ? ' on' : '')} onClick={() => setData((d) => ({ ...d, level: l.id }))}>
                <span className="lv-bars"><i /><i /><i /></span>
                <span className="lv-tx"><b>{l.title} <span className="yrs">{l.yrs}</span></b><span>{l.desc}</span></span>
                <span className="lv-radio"><i /></span>
              </button>
            ))}
          </div>
        </StepShell>
      </div>
    )
  }

  /* ---------- Q3 · GOAL ---------- */
  if (step === 3) {
    return (
      <div className="ob-card">
        {hiddenForm}
        <div className="ob-progress-top"><i style={{ width: '75%' }} /></div>
        <StepShell
          step={3} total={4} stepLabel="Step 3 of 4" data={data} xp={xp} name={name} username={username}
          q="What's your main goal?" sub="Pick the one that matters most right now. Your quests, streaks and reminders will all aim at this."
          onBack={() => go(2)} onNext={() => go(4)} nextDisabled={!data.goal}
        >
          <div className="ob-goals">
            {OB_GOALS.map((g) => (
              <button type="button" key={g.id} className={'ob-goal' + (data.goal === g.id ? ' on' : '')} onClick={() => setData((d) => ({ ...d, goal: g.id }))}>
                <span className="g-ic"><Icon name={g.icon} size={20} /></span>
                <b>{g.title}</b>
                <span>{g.desc}</span>
              </button>
            ))}
          </div>
        </StepShell>
      </div>
    )
  }

  /* ---------- Q4 · VISIBILITY ---------- */
  if (step === 4) {
    return (
      <div className="ob-card">
        {hiddenForm}
        <div className="ob-progress-top"><i style={{ width: '100%' }} /></div>
        <StepShell
          step={4} total={4} stepLabel="Step 4 of 4" data={data} xp={xp} name={name} username={username}
          q="Public or private?" sub="Most traders go public to learn faster — but you're in control. Change this anytime from your settings."
          onBack={() => go(3)} onNext={() => go(5)} nextDisabled={!data.visibility} nextLabel="Create my profile"
        >
          <div className="ob-vis">
            {OB_VIS.map((v) => (
              <button type="button" key={v.id} className={'ob-visopt' + (data.visibility === v.id ? ' on' : '')} onClick={() => setData((d) => ({ ...d, visibility: v.id }))}>
                <span className="v-ic"><Icon name={v.icon} size={24} /></span>
                <b>{v.title}</b>
                <p>{v.desc}</p>
                <div className="v-tags">{v.tags.map((t) => <span key={t}>{t}</span>)}</div>
                <span className="v-check"><Icon name="check" size={13} /></span>
              </button>
            ))}
          </div>
        </StepShell>
      </div>
    )
  }

  /* ---------- REVEAL ---------- */
  const pickedMarkets = OB_MARKETS.filter((m) => data.markets.includes(m.id))
  const confettiCols = ['#7C5CE6', '#C840BC', '#FF7A4D', '#3FB6E8', '#34D399', '#FFD27A']

  return (
    <div className="ob-card">
      {hiddenForm}
      <div className="ob-hero">
        <div className="ob-grid-tex" />
        <div className="ob-confetti">
          {Array.from({ length: 28 }).map((_, i) => (
            <i key={i} style={{
              left: (i * 3.6 + (i % 3) * 4) + '%',
              background: confettiCols[i % confettiCols.length],
              animationDelay: (i % 7) * 0.12 + 's',
              transform: `rotate(${i * 33}deg)`,
            }} />
          ))}
        </div>
        <div className="ob-hero-badge"><Icon name="sparkle" size={14} /> Identity unlocked</div>
        <h1>You&apos;re officially a <span className="gr">{lvl ? lvl.rank : ''} Trader</span>.</h1>
        <p>Your card is live. Jump into the feed, follow your first traders and log a trade to start your streak.</p>

        <div className="ob-reveal-card">
          <div className="rc-top">
            <div className="ob-idav">
              <span className="ring"><span style={{ width: 58, height: 58, background: 'linear-gradient(135deg,#7C5CE6,#C840BC)' }} /></span>
              <span className="lvbadge">LV1</span>
            </div>
            <div>
              <div className="rc-name">{name} <span className="ob-verified"><Icon name="check" size={12} /></span></div>
              <div className="rc-handle">@{username}</div>
              <div className="rc-title"><Icon name="crown" size={12} /> {lvl ? lvl.rank : ''} Trader · Level 1</div>
            </div>
          </div>
          <div className="ob-reveal-tags">
            {pickedMarkets.map((m) => (
              <span key={m.id} className="ob-reveal-tag"><span className="sw" style={{ background: m.color }} /> {m.name}</span>
            ))}
            {goal && <span className="ob-reveal-tag"><Icon name={goal.icon} size={14} /> {goal.title}</span>}
            {vis && <span className="ob-reveal-tag"><Icon name={vis.icon} size={14} /> {vis.title}</span>}
          </div>
        </div>

        {state.error && <p className="ts-error" style={{ marginTop: 22 }}>{state.error} — <button type="button" onClick={() => go(0)} style={{ color: 'inherit', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>edit handle</button></p>}

        <div className="ob-hero-cta" style={{ marginTop: 30 }}>
          <button type="button" className="ob-next" onClick={submit} disabled={pending}>
            {pending ? 'Entering…' : 'Enter TradingSocial'} <Icon name="arrowRight" size={17} />
          </button>
          <div className="ob-hero-meta"><span>+90 XP earned</span><span className="dot" /><span>Level 1 reached</span></div>
        </div>
      </div>
    </div>
  )
}
