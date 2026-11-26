-- Rollback of 20270389 (Business Moments paused). Removes the enforcement: moment photos are accepted again with no screening
-- (moment videos stay refused by 20270388), so it is only for a defect in the pause itself; owner decides. Moments ended by
-- the migration stay ended.
drop trigger if exists ab_business_moments_paused on public.stories;
drop function if exists private._refuse_paused_business_moment();
drop table if exists private.business_moments_settings;
