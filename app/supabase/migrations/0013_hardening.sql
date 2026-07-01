-- 0013_hardening: address Supabase advisor findings (security + performance).
-- No schema/behaviour change. RLS semantics identical; only auth.uid() calls are
-- wrapped in (select ...) so Postgres evaluates them once per query, not per row.

-- ── Security ────────────────────────────────────────────────────────────────

-- handle_new_user is a SECURITY DEFINER trigger fn; it must not be callable as an
-- RPC by API roles. Triggers still fire (they run as table owner), this only
-- removes the /rest/v1/rpc/handle_new_user surface.
revoke execute on function public.handle_new_user() from anon, authenticated;

-- Pin search_path so the trigger fn can't be hijacked via a mutable path.
alter function public.touch_updated_at() set search_path = '';

-- ── Performance: covering indexes for foreign keys ──────────────────────────

create index if not exists comments_author_id_idx        on public.comments (author_id);
create index if not exists lesson_completions_lesson_idx  on public.lesson_completions (lesson_id);
create index if not exists likes_user_id_idx              on public.likes (user_id);
create index if not exists messages_sender_id_idx         on public.messages (sender_id);
create index if not exists notifications_actor_id_idx     on public.notifications (actor_id);
create index if not exists poll_votes_user_id_idx         on public.poll_votes (user_id);
create index if not exists posts_trade_id_idx             on public.posts (trade_id);

-- ── Performance: RLS initplan (wrap auth.uid() in a scalar subquery) ────────

alter policy comments_delete on public.comments
  using (author_id = (select auth.uid()));
alter policy comments_insert on public.comments
  with check (author_id = (select auth.uid()));

alter policy "participant select" on public.conversations
  using ((select auth.uid()) = user_a or (select auth.uid()) = user_b);

alter policy feedback_insert on public.feedback
  with check (user_id = (select auth.uid()));
alter policy feedback_select on public.feedback
  using (user_id = (select auth.uid()));

alter policy follows_delete on public.follows
  using (follower_id = (select auth.uid()));
alter policy follows_insert on public.follows
  with check (follower_id = (select auth.uid()));

alter policy likes_delete on public.likes
  using (user_id = (select auth.uid()));
alter policy likes_insert on public.likes
  with check (user_id = (select auth.uid()));

alter policy "participant select" on public.messages
  using (exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id
      and ((select auth.uid()) = c.user_a or (select auth.uid()) = c.user_b)
  ));

alter policy "owner select" on public.notifications
  using ((select auth.uid()) = user_id);

alter policy poll_options_insert on public.poll_options
  with check (exists (
    select 1 from public.posts p
    where p.id = poll_options.post_id and p.author_id = (select auth.uid())
  ));

alter policy poll_votes_delete on public.poll_votes
  using (user_id = (select auth.uid()));
alter policy poll_votes_insert on public.poll_votes
  with check (user_id = (select auth.uid()));
alter policy poll_votes_update on public.poll_votes
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy post_images_delete on public.post_images
  using (exists (
    select 1 from public.posts p
    where p.id = post_images.post_id and p.author_id = (select auth.uid())
  ));
alter policy post_images_insert on public.post_images
  with check (exists (
    select 1 from public.posts p
    where p.id = post_images.post_id and p.author_id = (select auth.uid())
  ));

alter policy posts_delete on public.posts
  using (author_id = (select auth.uid()));
alter policy posts_insert on public.posts
  with check (author_id = (select auth.uid()));
alter policy posts_update on public.posts
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

alter policy profiles_select on public.profiles
  using (((is_public = true) and (onboarding_completed = true)) or ((select auth.uid()) = id));
alter policy profiles_update on public.profiles
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

alter policy subscriptions_select on public.subscriptions
  using ((select auth.uid()) = user_id);

alter policy trades_delete on public.trades
  using ((select auth.uid()) = user_id);
alter policy trades_insert on public.trades
  with check ((select auth.uid()) = user_id);
alter policy trades_select on public.trades
  using ((is_public = true) or ((select auth.uid()) = user_id));
alter policy trades_update on public.trades
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
