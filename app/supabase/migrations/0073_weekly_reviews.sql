-- Completed weekly reviews: the evidence considered, and the next action chosen.
--
-- Audit 2026-09-05, Wave D6 / follow-up C3 — the last step of the basic
-- improvement cycle. Ungated, at every tier.
--
-- DEPLOY ORDER: migration first, code second. Deploys here are automatic and
-- migrations are not, so the interval between them is real. Without this table
-- the review card still renders and still counts correctly — the only thing
-- that fails is recording the next action, which returns "Could not save that."
-- That is the mild direction; the reverse is not available.
--
-- =============================================================================
-- WHY NOT `process_logs` (0070)
-- =============================================================================
--
-- It was the obvious home and it cannot hold this, for three separate reasons:
--
--   1. `kind` is a four-value CHECK constraint ('review', 'rule_reflection',
--      'no_trade', 'rest'). A fifth value is a schema change to the table the
--      whole reward system reads.
--   2. There is no text column. The audit asks a completed review to record the
--      EVIDENCE CONSIDERED and a CHOSEN NEXT ACTION. `process_logs` can record
--      that a review happened and nothing about what it concluded.
--   3. `process_logs_user_day_kind_uidx` caps a user at one row per kind per
--      day. That index is the anti-farm control for the entire reward surface
--      and 0071 already declined to weaken it; this migration declines too.
--
-- `process_logs.kind = 'review'` therefore keeps its meaning unchanged — "I sat
-- down and went over my trading", a habit marker. This table records what came
-- out of one. They are different facts and both are kept.
--
-- =============================================================================
-- WHY RENDERING A SUMMARY DOES NOT WRITE A ROW
-- =============================================================================
--
-- The audit is explicit that rendering a summary must not by itself count as a
-- completed review. Nothing on the read path touches this table: a row appears
-- only when the user picks keep / revise / retire and the server action writes
-- it. `weekly_review_viewed` (analytics_events) remains the "you looked at it"
-- signal it always was, with its existing meaning untouched, and this table is
-- deliberately NOT wired into `lib/server/goals.ts` as a third source for the
-- `weekly_reviews` goal — see that file for why two sources are already
-- de-duplicated by day and why a third would be a double count, not a fix.
--
-- =============================================================================
-- WHY THE EVIDENCE IS SERVER-WRITTEN
-- =============================================================================
--
-- The counts below are a snapshot of what the SERVER saw when the decision was
-- made, not a claim the client passed in. So `authenticated` gets SELECT on its
-- own rows and no INSERT or UPDATE at all: every write goes through
-- `actions/weekly-review.ts`, which re-derives the counts from `trades` and
-- `process_logs` itself and writes with the service client. A user can decide
-- anything they like about their own focus; they cannot author the evidence the
-- decision was recorded against.
--
-- `week_start`, `window_start`, `window_end` and `created_at` are server-set for
-- the item-15-F7 reason 0070 states at length: a habit record whose calendar
-- bucket is client-supplied can be backdated, and a backdated review measures
-- nothing. There is no backfill and that is deliberate.

create table if not exists public.weekly_reviews (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,

  -- Monday of the ISO week the review was recorded in, UTC. The anti-farm
  -- bucket: one completed review per user per calendar week. The window the
  -- evidence covers is the rolling 7 days below and is a different thing --
  -- both are stored so the row is self-describing and neither has to be
  -- re-derived from `created_at` later.
  week_start date not null default (
    ((now() at time zone 'utc')::date)
    - ((extract(isodow from (now() at time zone 'utc'))::int) - 1)
  ),
  window_start date not null default (((now() at time zone 'utc')::date) - 7),
  window_end   date not null default ((now() at time zone 'utc')::date),

  -- The next action. Three values, not two: retiring a focus a trader has
  -- outgrown is the cycle closing, not the user quitting.
  decision text not null,

  -- The focus the decision was about, as a process_goals `kind` string. NOT a
  -- foreign key, on purpose: retiring the focus deletes the goal row, and the
  -- review that decided to retire it must outlive it. Nullable, because a user
  -- with no focus set can still have nothing to keep, revise or retire -- the
  -- card offers them "set a focus" instead and writes no row.
  focus_kind text,

  -- The evidence considered, exactly as the card showed it. Counts only: this
  -- is the free side of the line, where the review answers what the user DID
  -- and never what it earned. No money, no win rate, no R.
  trades_closed    integer not null default 0,
  reflected        integer not null default 0,
  followed         integer not null default 0,
  broke            integer not null default 0,
  unsure           integer not null default 0,
  unreflected      integer not null default 0,
  stood_aside_days integer not null default 0,

  -- One optional sentence. Capped for the reason 0071 caps `reflection_note`:
  -- a cap in the column is what stops it quietly becoming a second, ungated
  -- copy of `trades.note` (which is `private_notes`, a Trader perk, and stays
  -- one).
  note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint weekly_reviews_decision_check
    check (decision in ('keep', 'revise', 'retire')),
  constraint weekly_reviews_note_len
    check (note is null or char_length(note) <= 280),
  constraint weekly_reviews_counts_nonneg
    check (
      trades_closed >= 0 and reflected >= 0 and followed >= 0 and broke >= 0
      and unsure >= 0 and unreflected >= 0 and stood_aside_days >= 0
    ),
  -- The four buckets partition the trades handed in -- the invariant
  -- `countReflections` guarantees and the denominator the card rests on. If a
  -- write ever violates it the counts are describing two different populations
  -- and the row is worthless, so it is refused rather than stored.
  constraint weekly_reviews_counts_partition
    check (
      followed + broke + unsure = reflected
      and reflected + unreflected = trades_closed
    ),
  constraint weekly_reviews_window_order
    check (window_start <= window_end)
);

-- One completed review per user per ISO week. Re-deciding within the same week
-- amends the row rather than adding a second: a trader who changes their mind
-- on Thursday has done one review, not two.
create unique index if not exists weekly_reviews_user_week_uidx
  on public.weekly_reviews (user_id, week_start);
-- Read path: this user's reviews, newest first (this week's row, and last
-- week's decision to show beside it).
create index if not exists weekly_reviews_user_week_idx
  on public.weekly_reviews (user_id, week_start desc);

alter table public.weekly_reviews enable row level security;

-- Read your own, and only your own. There is no write policy because there is
-- no client write -- see the grants below.
drop policy if exists weekly_reviews_select on public.weekly_reviews;
create policy weekly_reviews_select on public.weekly_reviews
  for select to authenticated using ((select auth.uid()) = user_id);

-- Grants, the 0045/0067/0070 idiom. RLS says WHICH ROW; these say WHICH COLUMN
-- -- and here the answer is none. Writes are service-client only, from
-- `actions/weekly-review.ts`, so the evidence columns cannot be authored by the
-- client that the decision is being recorded against.
revoke insert, update, delete on public.weekly_reviews from anon, authenticated;
-- `anon` gets nothing at all, for the reason 0045, 0067 and 0071 all give: an
-- anonymous caller owns no row here and the select policy would refuse anyway.
revoke select on public.weekly_reviews from anon;

-- `updated_at` on amendment. Same trigger function 0026 installed for
-- subscriptions; created here only if it is missing so this file can be applied
-- to a database that has not seen it.
create or replace function public.weekly_reviews_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists weekly_reviews_touch on public.weekly_reviews;
create trigger weekly_reviews_touch before update on public.weekly_reviews
  for each row execute function public.weekly_reviews_touch_updated_at();
