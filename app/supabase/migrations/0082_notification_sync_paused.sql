-- Allow the 'sync_paused' notification type.
--
-- APPLY THIS BEFORE MERGING. The MT5 collect route inserts 'sync_paused' once
-- the code deploys; without this migration notifications_type_check rejects the
-- insert. insertSystemNotification logs the error and carries on, so nothing
-- breaks — the notice simply never arrives.
--
--   production  jmpanzrjxflovdfwcbye
--   dev         sixixwutvrguqemqzvvw
--
-- ── WHY ──────────────────────────────────────────────────────────────────────
--
-- When a user's plan stops including MT5 auto-sync, the hourly collect run
-- skips their account. It used to send them 'sync_failed' — "Broker sync
-- failed — reconnect to keep verifying" — on the first skip and then once a
-- day for as long as the plan stayed lapsed. Nothing had failed and there was
-- nothing to reconnect: the product had paused sync on purpose. One real user
-- received that daily from 2026-09-14.
--
-- 'sync_paused' is sent once per lapse instead, and says what happened.
--
-- Transactional, like 'feedback_reply' and the billing notices: it is NOT added
-- to PREF_KEYS in app/src/app/actions/notifications.ts. It is a one-off notice
-- of an account-state change, not a recurring nudge.
--
-- Same drop/add shape as 0032, 0049 and 0066: the constraint is restated in
-- full — the current list plus one value.

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'like', 'comment', 'follow', 'post_share', 'mention', 'message',
    'weekly_report', 'import_done', 'sync_failed', 'goal_completed', 'rule_breach', 'new_learning',
    'payment_failed', 'trial_ending', 'trial_expired',
    'feedback_reply',
    'sync_paused'
  ));
