-- Custom profile badge (Trader+ perk) — user picks a preset flair shown on
-- their public profile next to the display name. Free stays on the plain
-- level tag ("Basic"); Pro additionally keeps the separate pro_badge checkmark.
alter table public.profiles add column if not exists custom_badge text;

insert into public.feature_flags (feature, free, trader, pro) values
  ('custom_badge', false, true, true)
on conflict (feature) do nothing;
