-- Admin replies to user feedback.
--
-- Until now `feedback` was a one-way pipe: a user sent a message, an admin
-- triaged it into a status and a category, and the user never heard anything
-- back. The reply lives on the feedback row itself rather than in a messages
-- table because the triage model it sits beside is single-valued — one status,
-- one category, and now one reply that can be rewritten. A thread would need
-- its own table, its own RLS, and a user-side compose box, none of which the
-- product has asked for; adding three columns keeps the answer next to the
-- question and can be widened later without a data migration.
--
-- APPLY THIS *BEFORE* THE CODE THAT USES IT, unlike 0049. The reply is not a
-- best-effort side channel: replyToFeedback's update names the three columns
-- directly and PostgREST rejects the whole statement if they do not exist, so
-- an admin pressing Send against an unmigrated database gets "Update failed."
-- and nothing is written. Nothing is corrupted by the wrong order — the
-- feature is simply unavailable until this lands.

-- 1) The reply itself -----------------------------------------------------------
-- `admin_reply` shares the 1..2000 bound with `message` (0006) and with
-- FEEDBACK_MAX in app/src/lib/feedback.ts, so an admin cannot answer at greater
-- length than a user can ask. NULL is "not answered yet", which is what the
-- admin list and the user's own view both branch on.
--
-- `admin_reply_by` is `on delete set null`, not `cascade`: an admin leaving the
-- team must not delete the answers they gave. The column exists for the audit
-- trail and the admin console — it is deliberately never shown to the
-- submitter, who sees the reply as coming from the team (see the actor_id null
-- in the notification below).
alter table public.feedback
  add column if not exists admin_reply text
    check (admin_reply is null or char_length(admin_reply) between 1 and 2000),
  add column if not exists admin_reply_at timestamptz,
  add column if not exists admin_reply_by uuid references public.profiles(id) on delete set null;

-- No new RLS policy. `feedback_select` (0006) is
-- `for select using (user_id = auth.uid())` — a row-level predicate with no
-- column list, so the submitter's own row now carries the reply columns along
-- with everything else it already returned.
--
-- No column grant either, and this was checked rather than assumed: unlike
-- public.profiles (0047) and public.exchange_accounts (0037), no migration has
-- ever revoked SELECT on public.feedback from `authenticated`, so the grant is
-- still table-wide and picks up new columns automatically. If SELECT is ever
-- narrowed to a column list on this table, these three have to be added to it
-- or the user-facing view at /settings/feedback goes silently blank — the row
-- still comes back, just without the fields the page renders.

-- 2) The notification -----------------------------------------------------------
-- Same drop/add shape as 0032 and 0049: the constraint has to be restated in
-- full, so this is the whole current list plus one value.
--
-- 'feedback_reply' is transactional and is deliberately NOT added to PREF_KEYS
-- in app/src/app/actions/notifications.ts, following the convention 0049 set
-- for the billing notices. A user who asked us a question cannot be opted out
-- of hearing the answer — and because PREF_KEYS is a whitelist on write, the
-- key can never appear in notification_prefs, so insertSystemNotification's
-- opt-out check can never suppress it.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'like', 'comment', 'follow', 'post_share', 'mention', 'message',
    'weekly_report', 'import_done', 'sync_failed', 'goal_completed', 'rule_breach', 'new_learning',
    'payment_failed', 'trial_ending', 'trial_expired',
    'feedback_reply'
  ));

-- entity_type was last widened in 0012 for 'conversation'. The reply notice
-- carries the feedback id so the bell can link at the item rather than at the
-- list, which needs 'feedback' to be a legal entity_type.
alter table public.notifications drop constraint if exists notifications_entity_type_check;
alter table public.notifications add constraint notifications_entity_type_check
  check (entity_type in ('post', 'comment', 'trade', 'conversation', 'feedback'));
