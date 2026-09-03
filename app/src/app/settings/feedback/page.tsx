import { redirect } from 'next/navigation'
import { createClient, getSessionUser } from '@/lib/supabase/server'
import { FEEDBACK_TYPE_LABELS, type FeedbackType } from '@/lib/feedback'

/**
 * "Your messages" — everything this user sent through the help widget, with the
 * team's reply where there is one (0066).
 *
 * Before this page existed the reply had nowhere to be read: the only
 * non-admin read of `feedback` in the whole app was the GDPR export in
 * actions/account.ts, which is a download, not a destination. A notification
 * that says "we replied to your message" has to land somewhere the message and
 * the answer are both visible, or it is a dead end.
 *
 * Deliberately the ORDINARY client, never the service client. The rows are
 * selected by `feedback_select` from 0006 (`user_id = auth.uid()`), so the
 * filter is the database's, not this file's — the page cannot be made to show
 * somebody else's feedback by a mistake in a query string, because there is no
 * query string and no user id in the query at all.
 */
export default async function FeedbackHistoryPage() {
  const supabase = await createClient()
  const user = await getSessionUser(supabase)
  if (!user) redirect('/login')

  const { data: rows } = await supabase
    .from('feedback')
    .select('id, type, message, status, created_at, admin_reply, admin_reply_at')
    .order('created_at', { ascending: false })
    .limit(50)

  const list = rows ?? []
  const replied = list.filter((r) => r.admin_reply).length

  return (
    <main className="ts-page" style={{ maxWidth: 760 }}>
      <p className="eyebrow">Account</p>
      <h1 className="ts-h1 mt-3">Your messages</h1>
      <p className="ts-sub">
        Everything you&apos;ve sent us through the help button, and anything we sent back.
        {replied > 0 && ` ${replied} of ${list.length} ${list.length === 1 ? 'has' : 'have'} a reply.`}
      </p>

      {list.length === 0 ? (
        <div className="ts-card mt-5">
          <p className="ts-sub" style={{ margin: 0 }}>
            You haven&apos;t sent us anything yet. Use the <b>?</b> button in the corner of any
            page to report a bug or ask for something — replies show up here and in your
            notifications.
          </p>
        </div>
      ) : (
        <div className="mt-5" style={{ display: 'grid', gap: 12 }}>
          {list.map((r) => (
            // Anchored on the row id: the notification links to
            // /settings/feedback#f-<id> so a user with several submissions
            // lands on the one that was answered.
            <section key={r.id} id={`f-${r.id}`} className="ts-card" style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="eyebrow">{FEEDBACK_TYPE_LABELS[r.type as FeedbackType] ?? r.type}</span>
                <time className="ts-sub" dateTime={r.created_at} style={{ margin: 0, fontSize: 12.5 }}>
                  {new Date(r.created_at).toLocaleDateString()}
                </time>
                {r.status === 'closed' && <span className="v-badge">Closed</span>}
              </div>
              <p style={{ whiteSpace: 'pre-wrap', fontSize: 14, margin: 0 }}>{r.message}</p>

              {r.admin_reply ? (
                <div className="ts-callout" style={{ display: 'grid', gap: 6 }}>
                  <span className="eyebrow">TradingSocial replied</span>
                  <p style={{ whiteSpace: 'pre-wrap', fontSize: 14, margin: 0 }}>{r.admin_reply}</p>
                  {r.admin_reply_at && (
                    <time className="ts-sub" dateTime={r.admin_reply_at} style={{ margin: 0, fontSize: 12.5 }}>
                      {new Date(r.admin_reply_at).toLocaleDateString()}
                    </time>
                  )}
                </div>
              ) : (
                // Said plainly rather than left blank: "no reply yet" and "we
                // never read it" look identical on an empty card, and the
                // second is the thing a user filing a bug already suspects.
                <p className="ts-sub" style={{ margin: 0, fontSize: 12.5 }}>
                  No reply yet — we read everything, and not every message needs one.
                </p>
              )}
            </section>
          ))}
        </div>
      )}
    </main>
  )
}
