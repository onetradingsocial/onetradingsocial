-- Creator-style public profile (Pro-only perk): custom cover image, accent
-- theme, tagline + CTA button, and one pinned post shown near the top.
alter table public.profiles
  add column if not exists cover_url text,
  add column if not exists theme_color text,
  add column if not exists tagline text,
  add column if not exists cta_label text,
  add column if not exists cta_url text,
  add column if not exists pinned_post_id uuid references public.posts(id) on delete set null;
