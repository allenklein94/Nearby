-- Closes a known asymmetry flagged when social_invites was first built
-- (see CLAUDE.md "Outstanding: Invite People"): invite_friend_to_gathering
-- only ever sent a fire-and-forget push, with no persisted row anywhere —
-- so a gathering invite never showed up in Inbox's Invites tab (only
-- community invites did), and a missed/denied push meant the invite was
-- simply gone. Same function, same checks, unchanged — just also writes
-- a real social_invites row now, reusing the table send_social_invite
-- already established rather than inventing a second one.
create or replace function public.invite_friend_to_gathering(gathering_id_param uuid, friend_id_param uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  service_key text;
  v_inviter_name text;
  v_gathering_title text;
  v_gathering_host_id uuid;
  v_women_only boolean;
  v_friend_gender text;
  v_is_friend boolean;
  v_is_blocked boolean;
begin
  select exists(
    select 1 from friendships
    where status = 'accepted'
    and ((user_a = auth.uid() and user_b = friend_id_param) or (user_a = friend_id_param and user_b = auth.uid()))
  ) into v_is_friend;
  if not v_is_friend then
    raise exception 'You can only invite accepted friends';
  end if;

  select host_id, title, women_only into v_gathering_host_id, v_gathering_title, v_women_only from gatherings where id = gathering_id_param;

  if v_women_only then
    select gender into v_friend_gender from profiles where id = friend_id_param;
    if lower(coalesce(v_friend_gender, '')) not in ('female', 'woman') then
      raise exception 'This gathering is women-only';
    end if;
  end if;

  select exists(
    select 1 from blocks
    where (blocker_id = v_gathering_host_id and blocked_id = friend_id_param)
    or (blocker_id = friend_id_param and blocked_id = v_gathering_host_id)
  ) into v_is_blocked;
  if v_is_blocked then
    raise exception 'This person cannot be invited to this gathering';
  end if;

  insert into social_invites (inviter_id, invitee_id, invite_type, target_id)
  values (auth.uid(), friend_id_param, 'gathering', gathering_id_param)
  on conflict (inviter_id, invitee_id, invite_type, target_id) where status = 'pending' do nothing;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select display_name into v_inviter_name from profiles where id = auth.uid();
  perform net.http_post(
    url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
    body := jsonb_build_object(
      'recipient_id', friend_id_param,
      'title', coalesce(v_inviter_name, 'A friend') || ' invited you to a gathering',
      'body', coalesce(v_gathering_title, 'Check it out') || ' — tap to see the details.',
      'data', jsonb_build_object('type', 'gathering_invite', 'gathering_id', gathering_id_param)
    )
  );
end;
$function$;
