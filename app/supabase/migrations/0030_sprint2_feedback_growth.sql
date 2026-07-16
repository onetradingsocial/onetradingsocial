-- Sprint 2: micro-surveys (row 27), feedback categorisation (row 29),
-- campaign/acquisition attribution (row 40).

-- Micro-survey answers live in feedback with type 'survey' (meta.survey = key).
alter table public.feedback drop constraint if exists feedback_type_check;
alter table public.feedback add constraint feedback_type_check
  check (type in ('bug', 'feedback', 'feature', 'verification', 'account', 'survey', 'other'));

-- Admin triage category (separate from the user-chosen type).
alter table public.feedback
  add column if not exists category text
  check (category is null or category in (
    'bug', 'confusing_ux', 'missing_feature', 'performance',
    'verification', 'pricing', 'trust', 'education'
  ));

-- Acquisition source captured at signup (?ref= / utm_source / campaign codes).
alter table public.profiles
  add column if not exists acquisition_source text;
