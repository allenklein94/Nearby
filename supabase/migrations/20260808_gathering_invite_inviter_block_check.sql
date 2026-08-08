-- invite_friend_to_gathering() checked blocks only between the gathering's
-- HOST and the invitee, never between the INVITER (auth.uid()) and the
-- invitee -- the exact check send_social_invite() already has correctly.
-- Friendship being 'accepted' does not preclude a later block existing
-- between the same two people (no trigger removes a friendship on block),
-- so an inviter could still push-invite someone they've blocked, or who has
-- blocked them, to a gathering hosted by an unrelated third party. Adds the
-- missing check alongside the existing host<->invitee check, which stays.
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

  select exists(
    select 1 from blocks
    where (blocker_id = auth.uid() and blocked_id = friend_id_param)
    or (blocker_id = friend_id_param and blocked_id = auth.uid())
  ) into v_is_blocked;
  if v_is_blocked then
    raise exception 'This person cannot be invited';
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
