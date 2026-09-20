-- Rolled back. Past gathering invite: accept refused, dismiss -> 'expired'; future accept -> 'accepted'.
begin;
do $$
declare out text := ''; u2 uuid; g_past uuid; g_future uuid; i1 uuid; i3 uuid; msg text; st text; ids uuid[];
begin
  select array_agg(id) into ids from (select id from gatherings limit 2) s;
  if array_length(ids,1) < 2 then raise exception 'need 2 gatherings in db'; end if;
  g_past := ids[1]; g_future := ids[2];
  update gatherings set scheduled_at = now() - interval '1 day' where id = g_past;
  update gatherings set scheduled_at = now() + interval '2 days' where id = g_future;
  select id into u2 from profiles order by created_at limit 1;
  insert into social_invites (inviter_id, invitee_id, invite_type, target_id)
    select (select id from profiles where id <> u2 limit 1), u2, 'gathering', g_past returning id into i1;
  insert into social_invites (inviter_id, invitee_id, invite_type, target_id)
    select (select id from profiles where id <> u2 limit 1), u2, 'gathering', g_future returning id into i3;
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  begin perform respond_to_social_invite(i1, true); msg := 'NO ERROR'; exception when others then msg := sqlerrm; end;
  out := out || 'accept past -> ' || msg || E'\n';
  perform respond_to_social_invite(i1, false);
  select status into st from social_invites where id = i1; out := out || 'dismiss past -> ' || st || E'\n';
  perform respond_to_social_invite(i3, true);
  select status into st from social_invites where id = i3; out := out || 'accept future -> ' || st || E'\n';
  raise exception 'ROLLBACK_OK %', out;
end $$;
rollback;
