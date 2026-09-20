-- Item 73. Rolled back: the host can flip ask_local_businesses through normal RLS; a non-host cannot.
begin;
do $$
declare h uuid; o uuid; g uuid; n int;
begin
  select id into h from profiles order by created_at limit 1;
  select id into o from profiles where id <> h order by created_at limit 1;
  insert into gatherings (host_id, title, area, interest_tag, scheduled_at, visibility, is_public, ask_local_businesses)
  values (h, 'settings', 'x', 'Coffee', now() + interval '2 days', 'everyone', true, false) returning id into g;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role','authenticated')::text, true);
  update gatherings set ask_local_businesses = true where id = g;
  get diagnostics n = row_count;
  assert n = 0, 'non-host update touched a row';
  perform set_config('request.jwt.claims', json_build_object('sub', h, 'role','authenticated')::text, true);
  update gatherings set ask_local_businesses = true where id = g;
  get diagnostics n = row_count;
  assert n = 1, 'host update failed';
  reset role;
  assert (select ask_local_businesses from gatherings where id = g);
  raise notice 'host-settings-business-flag ok';
end $$;
rollback;
