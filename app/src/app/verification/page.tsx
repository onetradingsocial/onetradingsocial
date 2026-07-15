import type { Metadata } from 'next'
import Link from 'next/link'
import { VerificationBadge } from '@/app/_components/VerificationBadge'

export const metadata: Metadata = {
  title: 'How verification works — TradingSocial',
  description:
    'What each TradingSocial verification level means, what we can and cannot verify, how demo and live accounts are separated, and how often broker data refreshes.',
}

const S: Record<string, React.CSSProperties> = {
  page: { maxWidth: 760, margin: '0 auto', padding: '40px 20px 80px' },
  h2: { fontFamily: 'var(--font-display)', fontSize: 20, margin: '36px 0 10px' },
  p: { color: 'var(--dim)', lineHeight: 1.65, margin: '10px 0' },
  li: { color: 'var(--dim)', lineHeight: 1.65, margin: '6px 0' },
  card: { border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px', margin: '14px 0', background: 'var(--surface)' },
}

export default function VerificationMethodologyPage() {
  return (
    <main style={S.page}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 30, marginBottom: 8 }}>How verification works</h1>
      <p style={S.p}>
        Every trade, account and profile on TradingSocial carries a verification status. This page explains
        exactly what each level means, what we can and cannot verify, and how we keep demo results from being
        presented as live performance.
      </p>

      <h2 style={S.h2}>The verification levels</h2>

      <div style={S.card}>
        <VerificationBadge level="broker_connected" linked={false} />
        <p style={S.p}>
          The trader connected their MT5 account through our sync partner. Closed trades are pulled directly
          from the broker&apos;s records on a schedule — the trader never types them in. Execution data
          (instrument, direction, prices, size, profit, timestamps) is <strong>locked</strong>: it cannot be
          edited after import. Traders can still add journal notes, screenshots and tags.
        </p>
      </div>

      <div style={S.card}>
        <VerificationBadge level="statement_imported" linked={false} />
        <p style={S.p}>
          The trader uploaded an MT5 account statement file. Trades come from the broker&apos;s exported
          history rather than manual entry, and execution fields are locked after import — but a statement
          file is produced on the trader&apos;s machine, so it is a step below a live broker connection:
          a determined user could alter a file before uploading it. Suspected altered statements lose
          verification.
        </p>
      </div>

      <div style={S.card}>
        <VerificationBadge level="self_reported" linked={false} />
        <p style={S.p}>
          The trade was typed in manually. Self-reported results are useful for journaling but are
          <strong> not verified</strong> — treat them accordingly. Manual trades never appear equivalent to
          broker-synced trades anywhere on TradingSocial.
        </p>
      </div>

      <div style={S.card}>
        <VerificationBadge level="verification_pending" linked={false} />
        <p style={S.p}>
          A broker connection was requested and is being established. Results shown under this status have
          not yet been confirmed against broker records.
        </p>
      </div>

      <div style={S.card}>
        <VerificationBadge level="verification_failed" linked={false} />
        <p style={S.p}>
          The broker connection stopped working or could not be established (wrong credentials, closed
          account, broker-side issues), or imported data failed our integrity checks. Historical verified
          trades remain, but no new data is being confirmed.
        </p>
      </div>

      <h2 style={S.h2}>What TradingSocial receives</h2>
      <ul>
        <li style={S.li}>From broker connections: closed-deal history — symbol, direction, open/close price and time, volume, and net profit. We never receive or store broker passwords on our own servers; the connection is provisioned once through our sync partner.</li>
        <li style={S.li}>From statement imports: the trade rows contained in the uploaded MT5 report file.</li>
        <li style={S.li}>From manual entries: whatever the trader types in.</li>
      </ul>

      <h2 style={S.h2}>What we cannot verify</h2>
      <ul>
        <li style={S.li}>Whether an account is the trader&apos;s only account, or whether losing accounts exist elsewhere.</li>
        <li style={S.li}>Live vs demo status claimed by a broker server we cannot classify — the account-type label (Live / Demo / Prop-firm / Competition) is declared by the trader and displayed prominently, but is not independently confirmed.</li>
        <li style={S.li}>Deposits, withdrawals and account balances beyond what trade history implies.</li>
        <li style={S.li}>Anything about statement files beyond internal consistency — a file altered before upload can pass parsing.</li>
      </ul>

      <h2 style={S.h2}>Can trades be edited?</h2>
      <p style={S.p}>
        Imported trades (statement or broker) have their execution data locked at the database level — edits
        to prices, sizes, results or timestamps are rejected. Journal fields (notes, screenshots, emotional
        tags, strategy tags, visibility) stay editable. Manual trades can be edited by their owner, and every
        change is recorded in an immutable audit trail: original values, source, import timestamp, what
        changed, previous values, and who made the change.
      </p>

      <h2 style={S.h2}>How demo and live accounts are separated</h2>
      <p style={S.p}>
        Every account carries a declared type — Live, Demo, Prop-firm or Competition — shown on the profile
        and next to leaderboard entries. Leaderboards offer filters for verification level and account type,
        and demo results are never presented as live trading performance.
      </p>

      <h2 style={S.h2}>How often broker data refreshes</h2>
      <p style={S.p}>
        Connected MT5 accounts sync on a recurring schedule (roughly every few hours). A profile&apos;s
        &ldquo;last successful sync&rdquo; is displayed with its verification details. If syncing fails
        repeatedly, the account moves to <em>Verification failed</em> until the connection is repaired.
      </p>

      <h2 style={S.h2}>What removes verification</h2>
      <ul>
        <li style={S.li}>A broken or revoked broker connection (new data stops being verified).</li>
        <li style={S.li}>Statement files that fail integrity checks or appear altered.</li>
        <li style={S.li}>Duplicate or impossible trades, or multiple accounts presented as one continuous record.</li>
        <li style={S.li}>Confirmed reports of manipulated screenshots or misleading performance claims.</li>
      </ul>

      <h2 style={S.h2}>Questions or disputes</h2>
      <p style={S.p}>
        Think a profile is misrepresenting its results, or your own verification looks wrong? Use the in-app
        Help button (choose <em>Verification issue</em>) and the team will review it.
      </p>

      <p style={{ ...S.p, marginTop: 28 }}>
        <Link href="/leaderboard">← Back to the leaderboard</Link>
      </p>
    </main>
  )
}
