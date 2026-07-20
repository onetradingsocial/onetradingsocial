-- Ungate the Risk Management course. It was seeded before min_tier existed and
-- ended up on 'trader', but Foundations, Journal & Edge Analytics and Execution
-- & Market Mechanics all point readers at it for position sizing — so free
-- users hit a paywall mid-lesson on the one topic that is pure capital
-- preservation. Trader keeps Technical Analysis + Execution; Pro keeps
-- Psychology.
--
-- Its lessons are already at the free XP rung (100), so no XP change needed.
-- Idempotent.

update public.courses set min_tier = 'free' where slug = 'risk';
