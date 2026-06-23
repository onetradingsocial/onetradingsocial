-- Draft/publish flags for Learning Hub content. Drafts are hidden from users via
-- RLS; admin reads through the service-role client (bypasses RLS) and sees all.
alter table public.courses add column if not exists published boolean not null default false;
alter table public.lessons add column if not exists published boolean not null default false;

-- Keep existing seeded content live.
update public.courses set published = true where slug in ('foundations', 'risk');
update public.lessons set published = true
  where course_id in (select id from public.courses where slug in ('foundations', 'risk'));

-- Users see only published content.
drop policy if exists courses_select on public.courses;
create policy courses_select on public.courses for select to authenticated using (published);

drop policy if exists lessons_select on public.lessons;
create policy lessons_select on public.lessons for select to authenticated using (published);
