-- Record when a subscription first took real money, so dunning grace can be
-- limited to customers who have actually paid us.
--
-- APPLY THIS BEFORE MERGING, like 0076 and for the same reason: the column is
-- WRITTEN by the webhook, so code-first would fail the write and 500 the
-- handler. Migration first is harmless — the column sits unused until deploy.
--
--   production  jmpanzrjxflovdfwcbye
--   dev         sixixwutvrguqemqzvvw
--
-- ── WHY ──────────────────────────────────────────────────────────────────────
--
-- `past_due` grace exists for a RENEWAL that failed: an expired card, a bank
-- hold, a temporary limit. The customer has paid before, Stripe is still
-- retrying, and cutting their features off mid-retry punishes them for their
-- bank's behaviour.
--
-- A failed TRIAL CONVERSION lands in exactly the same status, and that customer
-- has never paid us anything. Before the trial moved to Stripe the two could not
-- be confused, because no subscription existed that had not been bought. Now
-- they are indistinguishable by status alone, and the grace window hands 14 days
-- of free Pro to every card that declines on day 14 — on top of the 14 trial
-- days it already had.
--
-- `subscriptionGrantsTier` already states the right principle: it refuses grace
-- to `incomplete` because "the FIRST payment never succeeded and the customer
-- has therefore never held the tier". This column is what lets that principle
-- apply to the case Stripe routes through `past_due` instead.
--
-- Owner decision, 2026-09-15: grace becomes SEVEN days, and only for a
-- subscription that has paid at least once. A never-paid subscription gets none.
--
-- ── WHAT COUNTS AS PAID ──────────────────────────────────────────────────────
--
-- Only an invoice with `amount_paid > 0`. A subscription opened in a trial
-- raises a A$0 invoice on day one which Stripe marks `paid`; treating that as
-- payment would set this column for every trialist on their first day and make
-- the whole change a no-op. The webhook checks the amount.
--
-- ── WHY THE BACKFILL IS SAFE ─────────────────────────────────────────────────
--
-- Every subscription that exists before this migration was a genuine purchase:
-- until the signup trial moved to Stripe, the only ways to create one were
-- buying a plan and claiming a referral reward, and production holds exactly one
-- row (cancelled). So `created_at` is a sound lower bound for "has paid", and
-- backfilling avoids a null that would mean two different things — "never paid"
-- for new rows and "we do not know" for old ones. After this, null means exactly
-- one thing.

alter table public.subscriptions
  add column if not exists first_paid_at timestamptz;

comment on column public.subscriptions.first_paid_at is
  'When this subscription first took a payment greater than zero. NULL = never paid, which withholds past_due dunning grace. Write-once: see subscriptions_first_paid_latch.';

update public.subscriptions
   set first_paid_at = created_at
 where first_paid_at is null;

-- ── THE LATCH, AND WHY IT IS A TRIGGER RATHER THAN A CONVENTION ──────────────
--
-- This column is OURS. Nothing in a Stripe payload carries it, so it is not part
-- of `subscriptionRow()` and never appears in the mirror upsert payload that the
-- webhook and the reconciliation cron both send.
--
-- That is exactly the problem. Two separate code paths upsert this table, and
-- whether an absent column survives an upsert depends on how PostgREST builds
-- the ON CONFLICT clause. If that behaviour is ever not what we assume — or if
-- someone later adds the column to SubscriptionRow with a null default — every
-- paying customer silently loses their grace window, and the symptom is a
-- customer in dunning being cut off early, which nobody reports as a bug.
--
-- A trigger makes the question moot. Once set, the value cannot be cleared by
-- any writer, from any path, however the statement is composed. It can still be
-- corrected by hand, because an explicit non-null write is honoured.
create or replace function public.subscriptions_keep_first_paid()
returns trigger language plpgsql as $$
begin
  if new.first_paid_at is null and old.first_paid_at is not null then
    new.first_paid_at := old.first_paid_at;
  end if;
  return new;
end $$;

drop trigger if exists subscriptions_first_paid_latch on public.subscriptions;
create trigger subscriptions_first_paid_latch
  before update on public.subscriptions
  for each row execute function public.subscriptions_keep_first_paid();

-- RLS unchanged: 0009 gives `authenticated` SELECT on their own rows and no
-- write policy at all, so this is service-role-write like every other column.

-- ── VERIFY ───────────────────────────────────────────────────────────────────
--
-- Column present, and no existing row left null:
--
-- select count(*) as total, count(first_paid_at) as stamped
-- from public.subscriptions;
--
-- Latch installed:
--
-- select tgname from pg_trigger
-- where tgrelid = 'public.subscriptions'::regclass
--   and tgname = 'subscriptions_first_paid_latch';
