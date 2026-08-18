-- Admin audit log hardening. Audit item 18, findings F5, F6 and F7.
--
-- ***************************************************************************
-- ** NOT APPLIED. Hand this to the owner. Deploy the code FIRST, then this. **
-- ***************************************************************************
--
-- Three problems in the one table:
--
--   F5  Rows record WHAT changed and never WHO-from-WHERE or WHAT-IT-WAS.
--       No IP, no user agent, no before-value, and no retention policy at all
--       -- the table grows forever and the UI reads the last 200 rows.
--
--   F6  The log is not immutable. RLS is on with zero policies, which correctly
--       denies anon/authenticated, but there is no UPDATE/DELETE trigger and
--       the service role bypasses RLS. Anyone holding the service key can
--       rewrite history -- while the UI told the reader "Append-only".
--
--   F7  actor_email was denormalised to survive profile deletion, so an admin
--       who exercises their own erasure right leaves their address in the log
--       permanently.
--
-- The application half ships first and is INERT WITHOUT THIS FILE, exactly as
-- 0051 was:
--
--   * logAdminAction()/logAdminRead() insert `ip` and `user_agent`. Until this
--     lands PostgREST answers 42703/PGRST204 and the code RETRIES the insert
--     with the pre-0052 column set (lib/server/admin-audit.ts, insertAudit).
--     Auditing keeps working; it just records less.
--   * pseudonymiseAdminAudit() targets `actor_email_hash`. Until this lands it
--     records `skipped: no_hash_column`, does not throw and does not abort a
--     deletion (lib/server/account-deletion.ts).
--   * /admin/audit selects `actor_email_hash` and falls back to the old column
--     list if the select fails (src/app/admin/audit/page.tsx).
--
-- Once applied, all three start working on the next request with no redeploy.

-- ---------------------------------------------------------------------------
-- 1. F5 -- request context on every row.
-- ---------------------------------------------------------------------------
--
-- `inet` rather than text: it is the correct type, it indexes sensibly, and it
-- rejects garbage. The application validates the value before sending and
-- sends NULL when it does not look like an address, because a parse failure
-- here would fail the whole insert and cost the audit row -- and an audit row
-- with no IP beats no audit row every time.
--
-- The IP comes from the FIRST hop of x-forwarded-for. On Vercel the platform
-- prepends the real peer address, so the first hop is the trustworthy one;
-- taking the last would faithfully record whatever the caller wrote. Treat it
-- as evidence, never as proof -- which is the correct standing for anything in
-- a log.

alter table public.admin_audit add column if not exists ip inet;
alter table public.admin_audit add column if not exists user_agent text;

comment on column public.admin_audit.ip is
  'Audit item 18 F5. First hop of x-forwarded-for at the time of the action. '
  'Evidence, not proof: the header is client-supplied and only the platform '
  'prefix is trustworthy. Null when unparseable or outside a request scope.';

comment on column public.admin_audit.user_agent is
  'Audit item 18 F5. Request user-agent, truncated to 512 chars by the app.';

-- ---------------------------------------------------------------------------
-- 2. F7 -- attribution that survives the actor's own erasure.
-- ---------------------------------------------------------------------------
--
-- Same pattern as 0051's trade_reports.reported_user_hash, deliberately: one
-- pseudonymisation rule in this codebase rather than two. Salted SHA-256 of the
-- normalised email, stamped by the application at deletion time from
-- DELETION_HASH_SALT, so the same departed person carries the same pseudonym in
-- both tables.
--
-- WHY NOT SIMPLY KEEP THE EMAIL, which is the other defensible answer.
--
-- Keeping it is arguable: admins act in a business capacity, and a controller's
-- legal-obligation and legitimate-interest bases for a security audit trail
-- (GDPR Art. 17(3)(b)/(e) and the Australian Privacy Act carve-outs) do outweigh
-- a staff member's erasure right over records of their own privileged acts.
-- That argument holds cleanly when the address is a role account on a domain
-- the company controls. It holds much less well HERE, where the production
-- admin is a personal Gmail (F8) -- "we retain your personal mailbox address
-- indefinitely" is a different sentence from "we retain admin@tradingsocial.io".
--
-- The pseudonym gives up nothing that the argument was protecting. Attribution
-- survives: two rows from the same departed admin still read as the same
-- actor, and the hash still matches a re-registration of the same address. What
-- goes is the ability to read a person's mailbox address out of the log, which
-- was never the thing the audit trail needed.
--
-- WHY THE EMAIL AND NOT THE UUID. actor_id is `on delete set null`, so by the
-- time the row is orphaned the uuid appears nowhere; a hash of it would be a
-- pseudonym for a value nothing can ever be matched against. The email is the
-- identity that persists across a re-registration. Same reasoning as 0051 §2.

alter table public.admin_audit add column if not exists actor_email_hash text;

comment on column public.admin_audit.actor_email_hash is
  'Audit item 18 F7. Salted SHA-256 of the acting admin''s email, stamped at '
  'their own account deletion, at which point actor_email is nulled. Null '
  'while the admin still exists -- actor_email answers the question then. '
  'Same salt and same formula as trade_reports.reported_user_hash so one '
  'person carries one pseudonym across both tables.';

create index if not exists admin_audit_actor_hash_idx
  on public.admin_audit (actor_email_hash)
  where actor_email_hash is not null;

-- ---------------------------------------------------------------------------
-- 3. F6 -- append-only, enforced by the database.
-- ---------------------------------------------------------------------------
--
-- A trigger, not a policy. RLS is bypassed by the service role; triggers are
-- not. This is what makes the "Append-only" badge on /admin/audit true of the
-- DATABASE and not merely of the app. Dropping the trigger requires table
-- ownership, which is itself a loud, separately-auditable act.
--
-- TWO CARVE-OUTS, BOTH NARROW AND BOTH DELIBERATE. A log that can never be
-- amended at all cannot honour an erasure request and cannot have a retention
-- policy, so the exceptions belong in the schema where they can be read, rather
-- than being implemented by someone disabling the trigger for an afternoon.
--
--   UPDATE is permitted for exactly one shape of change: clearing actor_email
--   to NULL while setting actor_email_hash from NULL to a value. Every other
--   column must be untouched. That is the F7 pseudonymisation and nothing else
--   -- an attacker cannot use it to change an action, a target or a timestamp,
--   and cannot use it to un-attribute a row (dropping actor_email without
--   supplying a hash is rejected).
--
--   DELETE is permitted only for rows older than the retention window. Those
--   rows are due for destruction anyway, so allowing it costs nothing that the
--   policy was not already giving away, and it means retention can be a plain
--   DELETE run by the owner of the job rather than a superuser exception.
--
-- Anything else raises, including TRUNCATE (see the statement-level trigger).

create or replace function public.admin_audit_retention_months()
returns integer language sql immutable as $$ select 24 $$;

comment on function public.admin_audit_retention_months() is
  'Audit item 18 F5. Retention window for admin_audit, in months. 24 months is '
  'the deliberate choice for a financial-adjacent product: long enough to '
  'cover an investigation that surfaces a year late, short enough that the '
  'table is not an ever-growing store of who-looked-at-whom. Expressed as a '
  'function so the value is in one place and the immutability trigger and the '
  'prune job cannot disagree about it.';

create or replace function public.admin_audit_guard()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.created_at >= now() - make_interval(months => admin_audit_retention_months()) then
      raise exception
        'admin_audit is append-only: row % is inside the % month retention window',
        old.id, admin_audit_retention_months()
        using errcode = 'raise_exception';
    end if;
    return old;
  end if;

  -- UPDATE. Permit only the F7 pseudonymisation, and nothing else.
  if old.actor_email is not null
     and new.actor_email is null
     and old.actor_email_hash is null
     and new.actor_email_hash is not null
     and new.id            is not distinct from old.id
     and new.actor_id      is not distinct from old.actor_id
     and new.action        is not distinct from old.action
     and new.target_type   is not distinct from old.target_type
     and new.target_id     is not distinct from old.target_id
     and new.detail        is not distinct from old.detail
     and new.created_at    is not distinct from old.created_at
     and new.ip            is not distinct from old.ip
     and new.user_agent    is not distinct from old.user_agent
  then
    return new;
  end if;

  raise exception
    'admin_audit is append-only: the only permitted UPDATE is replacing '
    'actor_email with actor_email_hash (account erasure)'
    using errcode = 'raise_exception';
end $$;

revoke execute on function public.admin_audit_guard() from public, anon, authenticated;
revoke execute on function public.admin_audit_retention_months() from public, anon, authenticated;

drop trigger if exists admin_audit_append_only on public.admin_audit;
create trigger admin_audit_append_only
  before update or delete on public.admin_audit
  for each row execute function public.admin_audit_guard();

-- Row triggers do not fire on TRUNCATE, which would otherwise erase the whole
-- log in one statement and satisfy every check above by never running them.
create or replace function public.admin_audit_no_truncate()
returns trigger language plpgsql as $$
begin
  raise exception 'admin_audit is append-only: TRUNCATE is not permitted'
    using errcode = 'raise_exception';
end $$;

revoke execute on function public.admin_audit_no_truncate() from public, anon, authenticated;

drop trigger if exists admin_audit_no_truncate on public.admin_audit;
create trigger admin_audit_no_truncate
  before truncate on public.admin_audit
  for each statement execute function public.admin_audit_no_truncate();

-- ---------------------------------------------------------------------------
-- 4. F5 -- retention, as a decision rather than an omission.
-- ---------------------------------------------------------------------------
--
-- The window is 24 months (§3). This function is the ONLY intended way rows
-- leave the table; it deletes strictly outside the window, so the trigger above
-- lets it through without any exception being made for it.
--
-- It is NOT scheduled by this migration. Scheduling is the owner's call and
-- needs a decision first: pg_cron on the Supabase project, or a new
-- api/cron/audit-prune route behind the existing CRON_SECRET + GitHub Actions
-- pattern (the same shape as crypto-sync and mt5-sync). Until it is scheduled
-- the policy is documented and enforceable but not enforced -- which is still
-- strictly better than the current state, where there is no policy to enforce.
--
-- Deliberately deletes rather than archiving. "Copy to cold storage first"
-- sounds more careful and in practice means the personal data is retained
-- indefinitely somewhere nobody audits. If a row is worth keeping past 24
-- months, lengthen the window and say so.

create or replace function public.admin_audit_prune()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  removed integer;
begin
  delete from public.admin_audit
   where created_at < now() - make_interval(months => admin_audit_retention_months());
  get diagnostics removed = row_count;
  return removed;
end $$;

revoke execute on function public.admin_audit_prune() from public, anon, authenticated;

comment on function public.admin_audit_prune() is
  'Audit item 18 F5. Deletes admin_audit rows older than the retention window '
  'and returns the count. NOT SCHEDULED by migration 0052 -- schedule it with '
  'pg_cron or an api/cron route behind CRON_SECRET.';

-- ---------------------------------------------------------------------------
-- 5. What this migration deliberately does NOT do
-- ---------------------------------------------------------------------------
--
-- F1 (durable fix)  It does NOT add profiles.is_admin. Admin identity is still
--       the ADMIN_EMAILS allowlist, now exact-address-only (commit 1c6ebce).
--       Moving admin into a column is the right destination and is a bigger
--       change than this file: it touches isAdmin(), requireAdmin(),
--       resolveTier(), adminUserIds() and the internal-traffic suppression,
--       and it needs a grant/revoke story of its own. Not smuggled in here.
--
-- F8    It does NOT change who the admin is. Migrating off a personal Gmail to
--       a role account on a controlled domain is an identity-provider task, not
--       a schema one -- and it is the change that makes the F7 argument above
--       come out differently.
--
-- F10   It does NOT delete the 401 test accounts, or the 21 on
--       @admin.tradingsocial.test. Those accounts can no longer become admin,
--       so this is cleanup rather than a live hole, and destroying 88% of the
--       rows in a production auth table is the owner's decision, made with a
--       verified backup in hand. See ws4-admin.md for what they hold.
--
-- No RLS change. admin_audit keeps RLS on with zero policies, which is already
-- deny-all for anon and authenticated. The trigger is what the service role
-- meets, and that is the gap this file closes.
