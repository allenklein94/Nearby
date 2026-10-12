-- Owner (2026-10-12): claiming a perk creates a code; only the business's confirmation establishes a real visit. Checks the
-- customer's own row (code readable again, claimed vs confirmed), the business confirmation path, and that the dashboard
-- stats, growth and the perk-tier count include confirmed visits only (pending claims neither lost nor double-counted).
-- Rolled back always. Run after migration 20270305 is applied (or prepend the migration for a dry run).
begin;
create temp table r(check_name text, ok boolean);
grant all on r to authenticated;
create temp table fx as
  select (select id from profiles order by created_at limit 1 offset 0) as owner,
         (select id from profiles order by created_at limit 1 offset 1) as cust_a,
         (select id from profiles order by created_at limit 1 offset 2) as cust_b,
         gen_random_uuid() as p, gen_random_uuid() as o1, gen_random_uuid() as o2, gen_random_uuid() as o3, gen_random_uuid() as o4;
grant all on fx to authenticated;
create temp table codes(k text primary key, code text);
grant all on codes to authenticated;
insert into brand_partners (id, name, active) select p, 'confirmed-visit fixture', true from fx;
insert into brand_offers (id, partner_id, title, reward_type, active) select x, fx.p, 'fixture perk', 'discount', true from fx, unnest(array[fx.o1, fx.o2, fx.o3, fx.o4]) x;
select set_config('app.trusted_update', 'true', true);
update profiles set managed_partner_id = (select p from fx) where id = (select owner from fx);

-- last month: one confirmed visit and one claim never confirmed (only the first may count toward growth)
insert into offer_redemptions (offer_id, user_id, redeemed_at, confirmed_at)
select fx.o4, fx.cust_a, date_trunc('month', now()) - interval '10 days', date_trunc('month', now()) - interval '9 days' from fx;
insert into offer_redemptions (offer_id, user_id, redeemed_at) select fx.o4, fx.cust_b, date_trunc('month', now()) - interval '10 days' from fx;

-- customer A claims o1 through the real client path (RLS insert), and gets a code
select set_config('request.jwt.claims', json_build_object('sub', (select cust_a from fx), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into offer_redemptions (offer_id, user_id) select o1, cust_a from fx;
insert into codes select 'a1', confirmation_code from offer_redemptions where offer_id = (select o1 from fx);
insert into r select 'claim: the customer reads their own code back, unconfirmed',
  (select count(*) = 1 and bool_and(confirmation_code ~ '^[0-9]{6}$' and confirmed_at is null) from offer_redemptions where offer_id = (select o1 from fx));
insert into r select 'claim: a claimed perk is never counted in the perk tier',
  (select count(*) = 1 from offer_redemptions where confirmed_at is not null); -- only last month's confirmed one
do $$ begin
  insert into offer_redemptions (offer_id, user_id) select o1, cust_a from fx;
  insert into r values ('claim: a second claim is refused', false);
exception when unique_violation then insert into r values ('claim: a second claim is refused (ALREADY_REDEEMED)', true);
end $$;
insert into r select 'claim: the code is still the same after the refused retry',
  (select confirmation_code = (select code from codes where k = 'a1') from offer_redemptions where offer_id = (select o1 from fx));
reset role;

-- the business's figures while A's claim is pending
select set_config('request.jwt.claims', json_build_object('sub', (select owner from fx), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into r select 'pending: total/this month/repeat count confirmed visits only (1 last month, 0 this month)',
  (select total_redemptions = 1 and redemptions_this_month = 0 and repeat_redeemers = 0 from fx, lateral get_business_dashboard_stats(fx.p));
-- the business confirms A's code
insert into r select 'confirm: the business confirms the code', ((confirm_offer_redemption((select code from codes where k = 'a1')))->>'success')::boolean;
insert into r select 'confirm: the same code cannot be confirmed twice', not ((confirm_offer_redemption((select code from codes where k = 'a1')))->>'success')::boolean;
insert into r select 'confirmed: counted once (total 2, this month 1, repeat 1: A has two confirmed visits)',
  (select total_redemptions = 2 and redemptions_this_month = 1 and repeat_redeemers = 1 from fx, lateral get_business_dashboard_stats(fx.p));
insert into r select 'growth: 1 confirmed this month vs 1 confirmed last month = 0% (last month''s pending claim ignored)',
  (select redemptions_growth_pct = 0 from fx, lateral get_business_growth(fx.p));
reset role;

-- customer A sees the confirmation; B claims o2 and o3, neither confirmed
select set_config('request.jwt.claims', json_build_object('sub', (select cust_a from fx), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into r select 'customer: the row now reads confirmed (badge state)',
  (select confirmed_at is not null from offer_redemptions where offer_id = (select o1 from fx));
insert into r select 'customer: perk tier counts 2 confirmed visits', (select count(*) = 2 from offer_redemptions where confirmed_at is not null);
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select cust_b from fx), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into offer_redemptions (offer_id, user_id) select x, cust_b from fx, unnest(array[fx.o2, fx.o3]) x;
insert into r select 'customer B: claims show, tier counts 0', (select count(*) filter (where confirmed_at is null) = 3 and count(*) filter (where confirmed_at is not null) = 0 from offer_redemptions);
insert into r select 'customer B: cannot read A''s rows', not exists (select 1 from offer_redemptions where user_id = (select cust_a from fx));
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select owner from fx), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into r select 'pending claims of B leave the figures unchanged',
  (select total_redemptions = 2 and redemptions_this_month = 1 and repeat_redeemers = 1 from fx, lateral get_business_dashboard_stats(fx.p));
reset role;
insert into r select 'the figures equal the confirmed rows (billing''s filter), no claim lost: 5 rows, 2 confirmed, 3 pending',
  (select count(*) = 5 and count(confirmed_at) = 2 from offer_redemptions o join fx on o.offer_id in (fx.o1, fx.o2, fx.o3, fx.o4));
insert into r select 'one overload each, grants unchanged (no anon)',
  (select count(*) = 2 from pg_proc where proname in ('get_business_dashboard_stats', 'get_business_growth'))
  and not has_function_privilege('anon', 'public.get_business_dashboard_stats(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.get_business_growth(uuid)', 'execute');
select check_name, ok from r;
rollback;
