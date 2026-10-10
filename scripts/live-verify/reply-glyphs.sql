-- Owner item 18 (2026-10-10). Rolled back. The pill's glyph = the push's glyph, requester only.
begin;
create temp table _r(step text, ok boolean) on commit drop;
grant all on _r to authenticated;
do $$
declare v_user uuid; v_stranger uuid; a uuid; b uuid; c uuid;
begin
  select id into v_user from profiles where managed_partner_id is null order by created_at limit 1;
  select id into v_stranger from profiles where id <> v_user and managed_partner_id is null order by created_at limit 1;
  insert into business_requests (requester_id, raw_text, category, party_size, latitude, longitude, radius_miles, expires_at, status)
  values (v_user, 'x', 'Coffee', 2, 40, -75, 15, now() + interval '1 day', 'open') returning id into a;
  insert into business_requests (requester_id, raw_text, category, party_size, latitude, longitude, radius_miles, expires_at, status)
  values (v_user, 'x', 'Wine', 2, 40, -75, 15, now() + interval '1 day', 'open') returning id into b;
  insert into business_requests (requester_id, raw_text, category, party_size, latitude, longitude, radius_miles, expires_at, status)
  values (v_user, 'x', 'Pickleball', 2, 40, -75, 15, now() + interval '1 day', 'open') returning id into c;
  perform set_config('app.u', v_user::text, true);
  perform set_config('app.s', v_stranger::text, true);
  perform set_config('app.ids', array[a, b, c]::text, true);
  perform set_config('app.a', a::text, true);
  perform set_config('app.c', c::text, true);
end $$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.u'), 'role','authenticated')::text, true);
insert into _r select 'coffee = ☕ (same as the push)', glyph = '☕' from get_reply_glyphs(current_setting('app.ids')::uuid[]) where request_id = current_setting('app.a')::uuid;
insert into _r select 'unmapped category = ✨', glyph = '✨' from get_reply_glyphs(current_setting('app.ids')::uuid[]) where request_id = current_setting('app.c')::uuid;
insert into _r select 'one row per own request', count(*) = 3 from get_reply_glyphs(current_setting('app.ids')::uuid[]);
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.s'), 'role','authenticated')::text, true);
insert into _r select 'stranger gets nothing', count(*) = 0 from get_reply_glyphs(current_setting('app.ids')::uuid[]);
reset role;
insert into _r select 'single overload, anon cannot execute',
  (select count(*) from pg_proc where proname = 'get_reply_glyphs') = 1 and not has_function_privilege('anon', 'public.get_reply_glyphs(uuid[])', 'execute');
select step, ok from _r;
select case when bool_and(ok) then 'ALL OK' else 'FAILED' end as result from _r;
rollback;
