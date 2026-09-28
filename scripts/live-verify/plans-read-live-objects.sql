-- Verifies migration 20270254 (item 134): plan views read the live object by id, never a stale creation-time copy.
-- Management API; ALWAYS rolled back.
begin;
create temp table r(check_name text, got text, want text);
do $t$
declare v_host uuid; v_owner uuid; v_g uuid; v_g2 uuid; v_plan uuid; v_exp uuid; v_bp uuid; v_ba uuid; v_ov jsonb; v_t text;
begin
  perform set_config('app.trusted_update', 'true', true);
  select g.id, g.host_id into v_g, v_host from gatherings g join plans p on p.resulting_gathering_id = g.id order by g.id limit 1;
  select id into v_plan from plans where resulting_gathering_id = v_g;
  select id into v_owner from profiles where id <> v_host order by id limit 1;
  select id into v_g2 from gatherings where id <> v_g order by id limit 1;
  select id into v_bp from brand_partners limit 1;

  -- (1) the host edits the gathering after the Plan was made
  update gatherings set title = 'Renamed coffee', scheduled_at = now() + interval '9 days', capacity = 7, area = 'Harbor' where id = v_g;
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  v_ov := get_plan_overview(v_plan);
  insert into r values ('plan title is the live gathering title', v_ov->'plan'->>'title', 'Renamed coffee');
  insert into r values ('plan time is the live gathering time', ((v_ov->'plan'->>'scheduled_at')::timestamptz = (select scheduled_at from gatherings where id = v_g))::text, 'true');
  insert into r values ('plan party size is the live capacity', v_ov->'plan'->>'party_size', '7');
  insert into r values ('plan place is the live area', v_ov->'plan'->>'location_label', 'Harbor');
  insert into r values ('the stored copy is untouched (no data rewritten)', ((select title from plans where id = v_plan) <> 'Renamed coffee')::text, 'true');

  -- (2) experience stops: a gathering stop and a posting stop, both renamed after being picked
  insert into plans(plan_type, created_by, title, status) values ('experience', v_owner, 'Night', 'draft') returning id into v_exp;
  update gatherings set visibility = 'everyone', women_only = false, host_id = v_host where id = v_g2;
  insert into business_availability(partner_id, title, starts_at, ends_at) values (v_bp, 'Old posting', now(), now() + interval '3 hours') returning id into v_ba;
  insert into plan_stops(plan_id, sort_order, component_key, component_label, stop_type, ref_id, partner_id, title, subtitle, category)
    values (v_exp, 1, 'a', 'Something to Do', 'gathering', v_g2, null, 'Old gathering title', null, null),
           (v_exp, 2, 'b', 'Dinner', 'business_availability', v_ba, v_bp, 'Old posting', 'Old business name', null);
  update gatherings set title = 'New gathering title' where id = v_g2;
  update business_availability set title = 'New posting' where id = v_ba;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  insert into r values ('gathering stop shows the live title', (select title from get_plan_stops(v_exp) where sort_order = 1), 'New gathering title');
  insert into r values ('posting stop shows the live posting title', (select title from get_plan_stops(v_exp) where sort_order = 2), 'New posting');
  insert into r values ('posting stop shows the live business name', (select subtitle from get_plan_stops(v_exp) where sort_order = 2), (select name from brand_partners where id = v_bp));
  -- a gathering the owner may no longer see: the rename is never revealed, the stored title stays
  update gatherings set visibility = 'invite_only', title = 'Secret new title' where id = v_g2;
  delete from gathering_interest where gathering_id = v_g2 and user_id = v_owner;
  delete from social_invites where target_id = v_g2 and invitee_id = v_owner;
  insert into r values ('private gathering stop: rename not revealed', (select title from get_plan_stops(v_exp) where sort_order = 2 - 1), 'Old gathering title');
  -- a gone object falls back to the stored copy
  delete from business_availability where id = v_ba;
  insert into r values ('deleted posting: stored title kept', (select title from get_plan_stops(v_exp) where sort_order = 2), 'Old posting');
  -- shared-night projection reads live business name too
  insert into r values ('shared-night projection: live business name', (select x->>'subtitle' from jsonb_array_elements(_night_stops_json(v_exp)) x where (x->>'order')::int = 2), (select name from brand_partners where id = v_bp));

  insert into r values ('single overloads', (select count(*)::text from pg_proc where proname in ('get_plan_overview', 'get_plan_stops', '_night_stops_json')), '3');
  insert into r values ('anon cannot read stops', has_function_privilege('anon', 'public.get_plan_stops(uuid)', 'execute')::text, 'false');
end $t$;
select check_name, got, want, (coalesce(got,'') = coalesce(want,'')) as ok from r;
rollback;
