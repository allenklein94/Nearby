-- Item 73: two real per-gathering host settings. host_notifications = the host's own join/request pushes for this
-- gathering (default on); allow_attendee_invites = whether anyone but the host can send invitations to it (default
-- on = today's behavior). Both enforced server-side.
alter table public.gatherings add column if not exists host_notifications boolean not null default true;
alter table public.gatherings add column if not exists allow_attendee_invites boolean not null default true;

CREATE OR REPLACE FUNCTION public.notify_gathering_interest()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  gathering_host_id uuid;
  gathering_title text;
  interested_user_name text;
  host_wants_notif boolean;
  service_key text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  select host_id, title into gathering_host_id, gathering_title from gatherings where id = new.gathering_id;
  select display_name into interested_user_name from profiles where id = new.user_id;
  select coalesce(notify_planning, true) into host_wants_notif from profiles where id = gathering_host_id;
  -- Item 73: the host can mute join/request pushes for THIS gathering.
  if not coalesce((select host_notifications from gatherings where id = new.gathering_id), true) then
    host_wants_notif := false;
  end if;

  if host_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', gathering_host_id,
        'title', case new.status
                     when 'approved' then 'Someone joined your gathering'
                     when 'waitlisted' then 'Someone joined your waitlist'
                     else 'New request to join your gathering' end,
        'body', interested_user_name || case new.status
                     when 'approved' then ' joined "'
                     when 'waitlisted' then ' joined the waitlist for "'
                     else ' asked to join "' end || gathering_title || '"',
        'data', jsonb_build_object('type', 'gathering_interest', 'gathering_id', new.gathering_id)
      )
    );
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_gathering_approved()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  gathering_title text;
  interested_user_wants_notif boolean;
  service_key text;
  v_host_id uuid;
begin
  if new.status = 'approved' and old.status in ('pending', 'waitlisted') then
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

    select title into gathering_title from gatherings where id = new.gathering_id;
    select coalesce(notify_planning, true) into interested_user_wants_notif from profiles where id = new.user_id;

    if interested_user_wants_notif then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', new.user_id,
          'title', case when old.status = 'waitlisted' then 'A spot opened up!' else 'You''re approved!' end,
          'body', case when old.status = 'waitlisted'
            then 'A spot opened up in "' || gathering_title || '" and you''re in! Start chatting!'
            else 'The host of "' || gathering_title || '" approved your request. Start chatting!' end,
          'data', jsonb_build_object('type', 'gathering_approved', 'match_id', new.match_id)
        )
      );
    end if;
  elsif new.status = 'pending' and old.status = 'waitlisted' then
    -- Waitlist promotion on an approval-required gathering: the person moves to the SAME pending state a normal request
    -- has (20270120). Tell the host there is a request to review and tell the person a spot opened up.
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
    select title, host_id into gathering_title, v_host_id from gatherings where id = new.gathering_id;
    if coalesce((select notify_planning from profiles where id = v_host_id), true)
       and coalesce((select host_notifications from gatherings where id = new.gathering_id), true) then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', v_host_id,
          'title', 'A spot opened up',
          'body', 'Next on the waitlist for "' || gathering_title || '" is waiting for your approval.',
          'data', jsonb_build_object('type', 'gathering_interest', 'gathering_id', new.gathering_id)
        )
      );
    end if;
    if coalesce((select notify_planning from profiles where id = new.user_id), true) then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', new.user_id,
          'title', 'A spot opened up',
          'body', 'A spot opened up in "' || gathering_title || '" — the host will review your request.',
          'data', jsonb_build_object('type', 'gathering_updated', 'gathering_id', new.gathering_id)
        )
      );
    end if;
  elsif new.status = 'waitlisted' and old.status = 'pending' then
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

    select title into gathering_title from gatherings where id = new.gathering_id;
    select coalesce(notify_planning, true) into interested_user_wants_notif from profiles where id = new.user_id;

    if interested_user_wants_notif then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', new.user_id,
          'title', 'Added to the waitlist',
          'body', '"' || gathering_title || '" is full, but you''re on the waitlist — we''ll let you know if a spot opens.',
          'data', jsonb_build_object('type', 'gathering_waitlisted', 'gathering_id', new.gathering_id)
        )
      );
    end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.invite_friend_to_gathering(gathering_id_param uuid, friend_id_param uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  v_inviter_name text;
  v_gathering_title text;
  v_gathering_host_id uuid;
  v_women_only boolean;
  v_friend_gender text;
  v_is_friend boolean;
  v_is_blocked boolean;
  v_wants_notif boolean;
begin
  if not coalesce((select allow_attendee_invites from gatherings where id = gathering_id_param), true)
     and auth.uid() is distinct from (select host_id from gatherings where id = gathering_id_param) then
    raise exception 'The host has turned off invitations for this gathering.';
  end if;

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

  select coalesce((select notify_planning from profiles where id = friend_id_param), true) into v_wants_notif;
  if not v_wants_notif then
    return;
  end if;

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

CREATE OR REPLACE FUNCTION public.send_social_invite(invite_type_param text, target_id_param uuid, invitee_id_param uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if invite_type_param not in ('gathering', 'community') then
    raise exception 'Invalid invite type';
  end if;

  if invitee_id_param = auth.uid() then
    raise exception 'Cannot invite yourself';
  end if;

  if not exists (
    select 1 from friendships
    where status = 'accepted'
      and ((user_a = auth.uid() and user_b = invitee_id_param)
        or (user_a = invitee_id_param and user_b = auth.uid()))
  ) then
    raise exception 'You can only invite friends';
  end if;

  if exists (
    select 1 from blocks
    where (blocker_id = auth.uid() and blocked_id = invitee_id_param)
       or (blocker_id = invitee_id_param and blocked_id = auth.uid())
  ) then
    raise exception 'This person cannot be invited';
  end if;

  if invite_type_param = 'gathering' and not exists (select 1 from gatherings where id = target_id_param) then
    raise exception 'Gathering not found';
  end if;

  if invite_type_param = 'community' and not exists (select 1 from communities where id = target_id_param) then
    raise exception 'Community not found';
  end if;

  if invite_type_param = 'gathering'
     and not coalesce((select allow_attendee_invites from gatherings where id = target_id_param), true)
     and auth.uid() is distinct from (select host_id from gatherings where id = target_id_param) then
    raise exception 'The host has turned off invitations for this gathering.';
  end if;

  insert into social_invites (inviter_id, invitee_id, invite_type, target_id)
  values (auth.uid(), invitee_id_param, invite_type_param, target_id_param)
  on conflict (inviter_id, invitee_id, invite_type, target_id) where status = 'pending' do nothing;
end;
$function$;
