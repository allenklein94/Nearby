-- Verifies migration 20270252: "Your community's top interests" shows an interest only when >= demand_min_people() distinct
-- followers share it; below that it is suppressed; top 5 kept; non-owner gets nothing. Management API; ALWAYS rolled back.
-- Prod has only a few profiles, so the floor is lowered to 3 inside the transaction for the positive case, then restored.
begin;
create temp table r(check_name text, got text, want text);
do $t$
declare v_owner uuid; v_partner uuid; v_f uuid[]; v_res text[];
begin
  perform set_config('app.trusted_update', 'true', true);
  select id, managed_partner_id into v_owner, v_partner from profiles where managed_partner_id is not null limit 1;
  select array_agg(id order by id) into v_f from profiles where id <> v_owner;
  -- 4 followers: 3 others + the owner. Coffee x4, Yoga x3, Hiking x1 (a lone follower's own interest).
  insert into business_followers(user_id, brand_partner_id) select u, v_partner from unnest(v_f || v_owner) u on conflict do nothing;
  update profiles set interests = array['Coffee','Yoga'] where id = v_f[1];
  update profiles set interests = array['Coffee','Yoga'] where id = v_f[2];
  update profiles set interests = array['Coffee','Yoga','Hiking'] where id = v_f[3];
  update profiles set interests = array['Coffee'] where id = v_owner;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  -- real floor (5): 4 followers -> nothing at all, not even Coffee with a smaller count
  select top_interests into v_res from get_business_insights(v_partner);
  insert into r values ('floor 5, 4 followers', array_to_string(v_res, ','), '');
  insert into r values ('floor value', demand_min_people()::text, '5');

  -- floor lowered to 3 in this transaction: Coffee (4) and Yoga (3) shown, Hiking (1) suppressed
  execute 'create or replace function public.demand_min_people() returns integer language sql immutable as $f$ select 3 $f$';
  select top_interests into v_res from get_business_insights(v_partner);
  insert into r values ('floor 3: shared interests only, most shared first', array_to_string(v_res, ','), 'Coffee,Yoga');

  -- non-owner gets nothing
  perform set_config('request.jwt.claims', json_build_object('sub', v_f[1], 'role', 'authenticated')::text, true);
  select top_interests into v_res from get_business_insights(v_partner);
  insert into r values ('non-owner', array_to_string(v_res, ','), '');

  insert into r values ('single overload', (select count(*)::text from pg_proc where proname = 'get_business_insights'), '1');
  insert into r values ('anon cannot execute', (not has_function_privilege('anon', 'public.get_business_insights(uuid)', 'execute'))::text, 'true');
end $t$;
select check_name, got, want, (got = want) as ok from r;
rollback;
