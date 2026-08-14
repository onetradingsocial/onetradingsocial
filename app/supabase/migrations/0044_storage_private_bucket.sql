-- Split user uploads into a public bucket and a private one, and close the
-- SVG hole on both. Audit item 07 (P0) + item 11 F1 (P1).
--
-- THE PROBLEM
--
-- `OneTradingSocial` is `public = true` and `pg_policies where schemaname =
-- 'storage'` returns zero rows, so every object in it is served to anyone on
-- the internet with no credential of any kind -- verified live: an
-- unauthenticated GET of a real trade chart returned 200 / image/png / 132516
-- bytes. The database and the object store disagree about who may see the same
-- content: `trades_select` is `is_public or auth.uid() = user_id`, so a private
-- trade's ROW is protected while its screenshot -- which typically shows
-- position size, account equity, broker and P&L -- is not. Same for DM
-- attachments, whose `messages` policy is participant-only.
--
-- WHY TWO BUCKETS RATHER THAN FLIPPING THE ONE
--
-- The five key prefixes are not one kind of content:
--
--   avatars/  covers/  posts/   -- public BY INTENT. `posts_select` and
--                                  `post_images_select` are both `qual = true`;
--                                  avatar_url is emitted into the profile
--                                  JSON-LD (app/src/app/[username]/page.tsx:297)
--                                  for anonymous crawlers, which cannot follow
--                                  a signed URL.
--   trades/   messages/          -- private BY INTENT.
--
-- Flipping the shared bucket to `public = false` would 400 every avatar, cover
-- and post image instantly (`Cache-Control: no-cache`, so no CDN grace period)
-- for a benefit that only applies to the other two prefixes. Splitting instead
-- leaves the four public objects and every URL that references them untouched,
-- and moves exactly one object.
--
-- KEY SHAPE -- the trap
--
-- Keys are `{kind}/{uid}/...`, NOT `{uid}/...`. So the uid lives at
-- `(storage.foldername(name))[2]`; the `[1]` form proposed by earlier passes
-- would compare auth.uid() against the literal 'trades'/'messages' and deny
-- everything. Both private prefixes carry the uid at index 2:
--
--   trades/{uid}/{tradeId}.{png|jpg}          -> {trades, uid}
--   messages/{uid}/{draftId}/{idx}.{png|jpg}  -> {messages, uid, draftId}
--
-- `avatars/{uid}.png` has no uid FOLDER at all, so no folder-based policy could
-- ever match it -- another reason that prefix stays in the public bucket.

-- 1. The private bucket. Explicit MIME subtypes, never a wildcard: `image/*`
--    admits `image/svg+xml`, and Supabase serves objects with no
--    `Content-Disposition` and no `X-Content-Type-Options: nosniff`, so a
--    script-bearing SVG stored under a .png key becomes active content on the
--    storage origin (item 11 F1). 5 MB matches what the chart uploader already
--    promises the user ("PNG, JPG up to 5MB",
--    app/src/app/_components/TradeModalProvider.tsx:387).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'OneTradingSocial-private',
  'OneTradingSocial-private',
  false,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. Same allowlist on the existing public bucket. Public does not mean
--    "anything goes" -- a wildcard on a world-readable bucket is strictly
--    worse, because the resulting SVG needs no credential to reach.
update storage.buckets
   set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
 where id = 'OneTradingSocial';

-- 3. Storage RLS for the private bucket.
--
-- `storage.objects` already has `relrowsecurity = true` with zero policies,
-- i.e. default-deny for every role without BYPASSRLS. The four policies below
-- are the first ever added to this schema, so they can only ADD access -- and
-- every one is scoped `bucket_id = 'OneTradingSocial-private'`, which leaves
-- the public bucket exactly as it was (still default-deny at row level; its
-- anonymous reads are authorised by the bucket.public short-circuit in the
-- storage API, before RLS is consulted).
--
-- Owner-only, path-scoped. `owner` is null on every existing object because all
-- uploads are minted by the service role (app/src/lib/storage.ts), so an
-- owner-column policy would match nothing -- the predicate has to come from the
-- key.
--
-- These policies govern DIRECT client access to the private bucket. Application
-- reads go through /api/private-image, which authorises the viewer against the
-- app's own visibility rules (a PUBLIC trade's chart is visible to everyone,
-- which owner-only RLS alone would wrongly forbid) and then mints a short-TTL
-- signed URL with the service role.
--
-- There is deliberately no `alter table storage.objects enable row level
-- security` here: that table is owned by `supabase_storage_admin`, so the
-- migration role cannot ALTER it ("must be owner of table objects"). RLS is
-- already enabled on it by Supabase (`pg_class.relrowsecurity = true`), which
-- is exactly why zero policies meant default-deny in the first place.

drop policy if exists private_objects_select on storage.objects;
create policy private_objects_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'OneTradingSocial-private'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

drop policy if exists private_objects_insert on storage.objects;
create policy private_objects_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'OneTradingSocial-private'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

drop policy if exists private_objects_update on storage.objects;
create policy private_objects_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'OneTradingSocial-private'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'OneTradingSocial-private'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

drop policy if exists private_objects_delete on storage.objects;
create policy private_objects_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'OneTradingSocial-private'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );
