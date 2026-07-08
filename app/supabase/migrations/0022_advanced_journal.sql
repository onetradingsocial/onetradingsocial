-- Advanced trading journal (Trader+ pricing row): gates the richer capture
-- fields in the trade modal — setup type, confidence, emotion check-in, and
-- chart screenshot upload. Bare-bones logging stays free.
insert into public.feature_flags (feature, free, trader, pro) values
  ('advanced_journal', false, true, true)
on conflict (feature) do nothing;
