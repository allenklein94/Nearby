-- Split the Social notification category: Friends vs Dating.
-- notify_social keeps meaning "Friends" (friend requests/accepts, friend discovery, stories, birthday/occasion
-- nudges, preference polls). New notify_dating gates everything on the dating side: the "It's a match" push, waves
-- (super notices), match messages, match reminders, video/voice calls, screenshot alerts and the shared-space
-- additions (timeline, memory, playlist, trip idea, constitution, stress test, shared decision).
-- Existing users are backfilled from notify_social so nobody's current setting changes. Function bodies are the live
-- definitions with only the gate column swapped (same signatures, so CREATE OR REPLACE stays a single overload).
alter table profiles add column if not exists notify_dating boolean not null default true;
update profiles set notify_dating = notify_social;

CREATE OR REPLACE FUNCTION public.check_mutual_notice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  matched_user_a uuid;
  matched_user_b uuid;
  new_match_id uuid;
  sender_name text;
  recipient_name text;
  to_user_wants_notif boolean;
  from_user_wants_notif boolean;
begin
  if exists (
    select 1 from notices
    where from_user = new.to_user and to_user = new.from_user
  ) then
    matched_user_a := least(new.from_user, new.to_user);
    matched_user_b := greatest(new.from_user, new.to_user);
    insert into matches (user_a, user_b)
    values (matched_user_a, matched_user_b)
    on conflict do nothing
    returning id into new_match_id;
    if new_match_id is not null then
      select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
      select display_name into sender_name from profiles where id = new.from_user;
      select display_name into recipient_name from profiles where id = new.to_user;

      select coalesce(notify_dating, true) into to_user_wants_notif from profiles where id = new.to_user;
      select coalesce(notify_dating, true) into from_user_wants_notif from profiles where id = new.from_user;

      if to_user_wants_notif then
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', new.to_user,
            'title', 'It''s a Match! 🎉',
            'body', 'You and ' || coalesce(sender_name, 'someone') || ' noticed each other.',
            'data', jsonb_build_object('type', 'new_match', 'match_id', new_match_id)
          )
        );
      end if;

      if from_user_wants_notif then
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', new.from_user,
            'title', 'It''s a Match! 🎉',
            'body', 'You and ' || coalesce(recipient_name, 'someone') || ' noticed each other.',
            'data', jsonb_build_object('type', 'new_match', 'match_id', new_match_id)
          )
        );
      end if;
    end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_constitution_addition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient uuid;
  recipient_wants_notif boolean;
  adder_name text;
  service_key text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  select case when m.user_a = new.added_by then m.user_b else m.user_a end
  into recipient
  from matches m where m.id = new.match_id;

  select notify_dating into recipient_wants_notif from profiles where id = recipient;
  select display_name into adder_name from profiles where id = new.added_by;

  if recipient_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', recipient,
        'title', '📜 New entry added',
        'body', adder_name || ' added something to your Constitution',
        'data', jsonb_build_object('type', 'constitution_addition', 'match_id', new.match_id)
      )
    );
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_memory_addition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient uuid;
  recipient_wants_notif boolean;
  adder_name text;
  service_key text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  select case when m.user_a = new.added_by then m.user_b else m.user_a end
  into recipient
  from matches m where m.id = new.match_id;

  select notify_dating into recipient_wants_notif from profiles where id = recipient;
  select display_name into adder_name from profiles where id = new.added_by;

  if recipient_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', recipient,
        'title', '💫 New memory added',
        'body', adder_name || ' added something to your Memory Vault',
        'data', jsonb_build_object('type', 'memory_addition', 'match_id', new.match_id)
      )
    );
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_new_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient uuid;
  recipient_wants_notif boolean;
  service_key text;
  sender_name text;
  notif_body text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select case when m.user_a = new.sender_id then m.user_b else m.user_a end
  into recipient
  from matches m where m.id = new.match_id;
  select notify_dating into recipient_wants_notif from profiles where id = recipient;
  select display_name into sender_name from profiles where id = new.sender_id;

  notif_body := case
    when new.audio_url is not null then 'Sent a voice message'
    when new.media_url is not null then 'Sent a photo'
    when new.gif_url is not null then 'Sent a GIF'
    when new.body is not null and new.body != '' then left(new.body, 100)
    else 'Sent a message'
  end;

  if recipient_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', recipient,
        'title', coalesce(sender_name, 'New message'),
        'body', notif_body,
        'data', jsonb_build_object('type', 'message', 'match_id', new.match_id)
      )
    );
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_playlist_addition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient uuid;
  recipient_wants_notif boolean;
  adder_name text;
  service_key text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  select case when m.user_a = new.added_by then m.user_b else m.user_a end
  into recipient
  from matches m where m.id = new.match_id;

  select notify_dating into recipient_wants_notif from profiles where id = recipient;
  select display_name into adder_name from profiles where id = new.added_by;

  if recipient_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', recipient,
        'title', '🎵 New song added',
        'body', adder_name || ' added "' || new.song_title || '" to your shared playlist',
        'data', jsonb_build_object('type', 'playlist_addition', 'match_id', new.match_id)
      )
    );
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_screenshot_taken(match_id_param uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  v_taker_id uuid := auth.uid();
  v_recipient uuid;
  v_taker_name text;
  v_recipient_wants_notif boolean;
begin
  select case when m.user_a = v_taker_id then m.user_b else m.user_a end
  into v_recipient
  from matches m where m.id = match_id_param and (m.user_a = v_taker_id or m.user_b = v_taker_id);

  if v_recipient is null then
    return;
  end if;

  select coalesce(notify_dating, true) into v_recipient_wants_notif from profiles where id = v_recipient;
  if not v_recipient_wants_notif then
    return;
  end if;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select display_name into v_taker_name from profiles where id = v_taker_id;

  perform net.http_post(
    url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
    body := jsonb_build_object(
      'recipient_id', v_recipient,
      'title', 'Screenshot taken',
      'body', coalesce(v_taker_name, 'Someone') || ' took a screenshot of your conversation.',
      'data', jsonb_build_object('type', 'screenshot', 'match_id', match_id_param)
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_shared_decision_addition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient uuid;
  recipient_wants_notif boolean;
  adder_name text;
  service_key text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  select case when m.user_a = new.added_by then m.user_b else m.user_a end
  into recipient
  from matches m where m.id = new.match_id;

  select notify_dating into recipient_wants_notif from profiles where id = recipient;
  select display_name into adder_name from profiles where id = new.added_by;

  if recipient_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', recipient,
        'title', '🧭 New thought shared',
        'body', adder_name || ' shared a thought in your Big Picture conversation',
        'data', jsonb_build_object('type', 'shared_decision_addition', 'match_id', new.match_id)
      )
    );
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_stress_test_addition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient uuid;
  recipient_wants_notif boolean;
  adder_name text;
  service_key text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  select case when m.user_a = new.added_by then m.user_b else m.user_a end
  into recipient
  from matches m where m.id = new.match_id;

  select notify_dating into recipient_wants_notif from profiles where id = recipient;
  select display_name into adder_name from profiles where id = new.added_by;

  if recipient_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', recipient,
        'title', '🧪 New "What If" thought',
        'body', adder_name || ' shared a thought on one of your scenarios',
        'data', jsonb_build_object('type', 'stress_test_addition', 'match_id', new.match_id)
      )
    );
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_super_notice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient_wants_notif boolean;
  service_key text;
  sender_name text;
begin
  if new.is_super = true then
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
    select notify_dating into recipient_wants_notif from profiles where id = new.to_user;
    select display_name into sender_name from profiles where id = new.from_user;
    if recipient_wants_notif then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', new.to_user,
          'title', coalesce(sender_name, 'Someone') || ' waved at you! 👋',
          'body', 'Open the app to see their profile.',
          'data', jsonb_build_object('type', 'wave')
        )
      );
    end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_timeline_addition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient uuid;
  recipient_wants_notif boolean;
  adder_name text;
  service_key text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  select case when m.user_a = new.added_by then m.user_b else m.user_a end
  into recipient
  from matches m where m.id = new.match_id;

  select notify_dating into recipient_wants_notif from profiles where id = recipient;
  select display_name into adder_name from profiles where id = new.added_by;

  if recipient_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', recipient,
        'title', '🗓️ New timeline thought',
        'body', adder_name || ' added a thought to your Timeline',
        'data', jsonb_build_object('type', 'timeline_addition', 'match_id', new.match_id)
      )
    );
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_trip_idea_addition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recipient uuid;
  recipient_wants_notif boolean;
  adder_name text;
  service_key text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  select case when m.user_a = new.added_by then m.user_b else m.user_a end
  into recipient
  from matches m where m.id = new.match_id;

  select notify_dating into recipient_wants_notif from profiles where id = recipient;
  select display_name into adder_name from profiles where id = new.added_by;

  if recipient_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', recipient,
        'title', '🧳 New trip idea',
        'body', adder_name || ' added an idea to your trip plan',
        'data', jsonb_build_object('type', 'trip_idea_addition', 'match_id', new.match_id)
      )
    );
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_video_call_started(match_id_param uuid, call_kind text DEFAULT 'video'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  v_caller_id uuid := auth.uid();
  v_recipient uuid;
  v_caller_name text;
  v_recipient_wants_notif boolean;
begin
  select case when m.user_a = v_caller_id then m.user_b else m.user_a end
  into v_recipient
  from matches m where m.id = match_id_param and (m.user_a = v_caller_id or m.user_b = v_caller_id);

  if v_recipient is null then
    return;
  end if;

  select coalesce(notify_dating, true) into v_recipient_wants_notif from profiles where id = v_recipient;
  if not v_recipient_wants_notif then
    return;
  end if;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select display_name into v_caller_name from profiles where id = v_caller_id;

  perform net.http_post(
    url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
    body := jsonb_build_object(
      'recipient_id', v_recipient,
      'title', coalesce(v_caller_name, 'Someone') || (case when call_kind = 'voice' then ' started a voice call' else ' started a video call' end),
      'body', 'Tap to join.',
      'data', jsonb_build_object('type', 'video_call', 'match_id', match_id_param, 'call_kind', call_kind)
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.send_match_reminders()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  m record;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for m in
    select mt.id, mt.user_a, mt.user_b, mt.matched_at,
           a.display_name as a_name, b.display_name as b_name,
           a.notify_dating as a_wants_notif, b.notify_dating as b_wants_notif
    from matches mt
    join profiles a on a.id = mt.user_a
    join profiles b on b.id = mt.user_b
    where mt.matched_at < now() - interval '24 hours'
      and mt.reminder_sent_at is null
      and not exists (select 1 from messages msg where msg.match_id = mt.id)
  loop
    if m.a_wants_notif then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', m.user_a,
          'title', 'Say hi to ' || coalesce(m.b_name, 'your match') || '! 👋',
          'body', 'You matched a day ago — send the first message.',
          'data', jsonb_build_object('type', 'match_reminder', 'match_id', m.id)
        )
      );
    end if;

    if m.b_wants_notif then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', m.user_b,
          'title', 'Say hi to ' || coalesce(m.a_name, 'your match') || '! 👋',
          'body', 'You matched a day ago — send the first message.',
          'data', jsonb_build_object('type', 'match_reminder', 'match_id', m.id)
        )
      );
    end if;

    update matches set reminder_sent_at = now() where id = m.id;
  end loop;
end;
$function$;
