-- Staging only: cleanup of the business-email E-test fixtures (nearby-staging, 2026-11-20).
-- Run through the staging Management API token only. Ends in ROLLBACK (dry run) unless the last line is changed to
-- COMMIT with the owner's approval. Stage B stays commented out until the remaining tests no longer need it.
begin;

-- Guard: refuse unless this database holds ONLY the labelled E-test fixtures (so it can never run on production).
do $$
begin
  if exists (select 1 from auth.users where email not like '%.e-tests@staging.nearby.invalid')
     or exists (select 1 from public.brand_partners where name not like 'Staging Test Business%(not real)') then
    raise exception 'Not the staging E-test database: refusing.';
  end if;
end $$;

-- Stage A: finished checks, nothing later reuses them (E4, E10, E19 requests; delivered outbox rows; records of
-- sessions that no longer exist). Cascades: business_request_offers, plans (resulting_business_request_id),
-- routing_decisions, business_lifecycle_events.
delete from public.business_requests
 where id in ('f4dc22cd-d150-46e0-8c63-0830a3742f7b', '1ae7f3c6-2da2-4478-a53f-de8b29d89286');
delete from public.push_outbox
 where recipient_id in (select id from auth.users where email like '%.e-tests@staging.nearby.invalid');
delete from private.location_aware_sessions a
 where not exists (select 1 from auth.sessions s where s.id = a.session_id);

-- Stage B (LATER, after the real-browser sign-in journey + phone checks; owner approval):
--   delete from public.brand_partners where id = 'e8000000-0000-4000-8000-0000000000e8';  -- L2: membership,
--     follower 9ce32ff2, message 222fea1d, alert windows cascade
--   delete from public.business_messages where partner_id in ('f570296c-ee03-4eb5-85ef-dc9406e1a7bd','7b49a1da-7473-4b89-bbd9-f2febc67055b');
--   delete from public.business_email_settings where user_id = '7bfdc2ed-fce2-42e5-963f-19a545d21873';
--   delete from public.brand_partners where id in ('f570296c-ee03-4eb5-85ef-dc9406e1a7bd','7b49a1da-7473-4b89-bbd9-f2febc67055b');
--   then the 4 test accounts via the Auth admin API (DELETE /auth/v1/admin/users/<id>), not SQL;
--   the owner removes the staging Resend key in Resend if it won't be reused.

select json_build_object(
  'requests', (select count(*) from public.business_requests),
  'request_rows', (select count(*) from public.business_request_offers),
  'plans', (select count(*) from public.plans),
  'routing_decisions', (select count(*) from public.routing_decisions),
  'outbox', (select count(*) from public.push_outbox),
  'aware_sessions', (select count(*) from private.location_aware_sessions),
  'businesses', (select count(*) from public.brand_partners),
  'messages', (select count(*) from public.business_messages),
  'email_settings', (select count(*) from public.business_email_settings),
  'accounts', (select count(*) from auth.users)) as after_stage_a;

rollback;
