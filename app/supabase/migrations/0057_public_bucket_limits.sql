-- Bound the public storage bucket. Audit item 11, finding F2.
--
-- ***************************************************************************
-- ** NOT APPLIED. Hand this to the owner and apply it WITH the WS8 deploy.  **
-- ***************************************************************************
--
-- WHY
--
-- Fix 02 created `OneTradingSocial-private` with `file_size_limit = 5242880`
-- (5 MB) and narrowed BOTH buckets' `allowed_mime_types` to four explicit image
-- subtypes, closing the SVG vector. What it deliberately left alone was the
-- public bucket's SIZE cap, which is still the Supabase default of 52428800
-- (50 MB). That half of F2 was recorded as outstanding; this is it.
--
-- The cap is the ONLY enforceable size control that exists. All five image
-- paths are direct-to-Supabase: the server mints a signed upload URL and the
-- browser PUTs the bytes straight to storage, so our runtime never sees a byte
-- and cannot check anything. WS8 adds a client-side downscale + size check in
-- `app/src/lib/image-prep.ts`, but that is a UX and hygiene layer — an attacker
-- who skips the app and PUTs to a legitimately-minted token is bounded by this
-- number and nothing else.
--
-- Today: post images allow idx 0-3, DM attachments the same, and the signed-URL
-- routes permit 30 token mints per minute per user. At 50 MB an object that is
-- on the order of 1.5 GB/minute into a bucket with no quota.
--
-- WHY 5 MB
--
-- It matches the private bucket, so the two halves of the storage split behave
-- identically and there is one number to remember. It matches what the trade
-- chart uploader has always advertised. And it is generous for the actual
-- content: the two largest live objects are 1.7 MB and 1.0 MB, both unoptimised
-- phone screenshots, and both would still be accepted.
--
-- WHAT THIS DOES NOT DO
--
-- Existing objects are not affected — `file_size_limit` is checked on upload,
-- not retroactively. Nothing currently stored exceeds 5 MB, so nothing breaks.

begin;

update storage.buckets
   set file_size_limit = 5242880
 where id = 'OneTradingSocial'
   and file_size_limit is distinct from 5242880;

commit;

-- ---------------------------------------------------------------------------
-- VERIFY (run after applying, against jmpanzrjxflovdfwcbye)
--
--   select id, public, file_size_limit, allowed_mime_types
--     from storage.buckets order by id;
--
--   -- expect BOTH buckets at 5242880 with the same four subtypes:
--   --   OneTradingSocial         | t | 5242880 | {image/png,image/jpeg,image/webp,image/gif}
--   --   OneTradingSocial-private | f | 5242880 | {image/png,image/jpeg,image/webp,image/gif}
--
--   -- nothing already stored is over the new cap:
--   select name, (metadata->>'size')::bigint as bytes
--     from storage.objects
--    where (metadata->>'size')::bigint > 5242880;   -- expect 0 rows
--
-- ROLLBACK
--
--   update storage.buckets set file_size_limit = 52428800
--    where id = 'OneTradingSocial';
-- ---------------------------------------------------------------------------
