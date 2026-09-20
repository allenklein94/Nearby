-- Item 73. Rolled back: allow_attendee_invites=false stops everyone but the host from inviting (both paths);
-- host_notifications=false silences the host's join push for that gathering only.
begin;
do $$
declare
  h uuid; a uuid; f uuid; g uuid; ok boolean; n0 int; n1 int;
begin
  select id into h from profiles order by created_at limit 1;
  select id into a from profiles where id <> h order by created_at limit 1;
  select id into f from profiles where id not in (h, a) order by created_at limit 1;
  insert into gatherings (host_id, title, area, interest_tag, scheduled_at, visibility, is_public)
  values (h, 'settings', 'x', 'Coffee', now() + interval '2 days', 'everyone', true) returning id into g;
  insert into friendships (user_a, user_b, status, requested_by) values (least(a,f), greatest(a,f), 'accepted', a), (least(h,f), greatest(h,f), 'accepted', h)
    on conflict do nothing;
  -- invites: default on = attendee may invite
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role','authenticated')::text, true);
  perform public.send_social_invite('gathering', g, f);
  delete from social_invites where target_id = g;
  update gatherings set allow_attendee_invites = false where id = g;
  begin perform public.send_social_invite('gathering', g, f); ok := false; exception when others then ok := sqlerrm like '%turned off invitations%'; end;
  assert ok, 'attendee refused (send_social_invite)';
  begin perform public.invite_friend_to_gathering(g, f); ok := false; exception when others then ok := sqlerrm like '%turned off invitations%'; end;
  assert ok, 'attendee refused (invite_friend_to_gathering)';
  perform set_config('request.jwt.claims', json_build_object('sub', h, 'role','authenticated')::text, true);
  perform public.send_social_invite('gathering', g, f);
  assert exists (select 1 from social_invites where target_id = g and inviter_id = h), 'host still invites';
  -- host notifications
  select count(*) into n0 from net.http_request_queue where convert_from(body,'utf8') like '%"type": "gathering_interest"%';
  insert into gathering_interest (gathering_id, user_id, status) values (g, a, 'approved');
  select count(*) into n1 from net.http_request_queue where convert_from(body,'utf8') like '%"type": "gathering_interest"%';
  assert n1 = n0 + 1, 'host pushed by default';
  update gatherings set host_notifications = false where id = g;
  delete from gathering_interest where gathering_id = g;
  insert into gathering_interest (gathering_id, user_id, status) values (g, a, 'approved');
  select count(*) into n0 from net.http_request_queue where convert_from(body,'utf8') like '%"type": "gathering_interest"%';
  assert n0 = n1, 'no host push when muted for this gathering';
  raise notice 'host-gathering-settings ok';
end $$;
rollback;
