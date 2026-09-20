-- Waitlist promotion respects approval (20270120). When a spot frees and someone is waitlisted:
--   * approval NOT required (public, requires_approval = false): unchanged, the next waitlisted person is approved
--     automatically (and matched with the host, as before);
--   * approval required (requires_approval OR non-public, the same predicate as join_gathering): the next waitlisted
--     person becomes PENDING -- the exact state a normal request has -- so the host approves them through the existing
--     approval flow. Same person order (earliest join first), no new rows, no second approval system.
-- A pending person holds the freed slot for the decision only, so a second waitlisted person is not promoted while a
-- slot is spoken for; if that pending person is declined or withdraws, the next one is promoted (the slot is never lost).
-- Both places that freed a slot (leave_gathering, host_remove_gathering_attendee) now share this one helper.

create or replace function public._promote_from_waitlist(gathering_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_host uuid; v_capacity integer; v_needs_approval boolean;
  v_approved integer; v_pending integer;
  v_next uuid; v_next_user uuid;
begin
  select host_id, capacity, (not coalesce(is_public, true)) or coalesce(requires_approval, false)
    into v_host, v_capacity, v_needs_approval
    from gatherings where id = gathering_id_param;
  if v_host is null or v_capacity is null then return null; end if;

  select count(*) filter (where status = 'approved'), count(*) filter (where status = 'pending')
    into v_approved, v_pending
    from gathering_interest where gathering_id = gathering_id_param;
  if v_approved >= v_capacity then return null; end if;
  if v_needs_approval and v_approved + v_pending >= v_capacity then return null; end if;

  select id into v_next from gathering_interest
   where gathering_id = gathering_id_param and status = 'waitlisted'
   order by created_at asc limit 1 for update;
  if v_next is null then return null; end if;

  if v_needs_approval then
    update gathering_interest set status = 'pending' where id = v_next returning user_id into v_next_user;
    return jsonb_build_object('user_id', v_next_user, 'status', 'pending');
  end if;

  update gathering_interest set status = 'approved' where id = v_next returning user_id into v_next_user;
  insert into matches (user_a, user_b, source_gathering_id)
  values (least(v_host, v_next_user), greatest(v_host, v_next_user), gathering_id_param)
  on conflict (user_a, user_b) do update set source_gathering_id = gathering_id_param
    where matches.source_gathering_id is null;
  return jsonb_build_object('user_id', v_next_user, 'status', 'approved');
end;
$fn$;
revoke all on function public._promote_from_waitlist(uuid) from public, anon, authenticated;

create or replace function public.leave_gathering(gathering_id_param uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_host_id uuid;
  v_scheduled_at timestamptz;
  v_my_row_id uuid;
  v_my_status text;
  v_promoted jsonb;
begin
  select host_id, scheduled_at into v_host_id, v_scheduled_at
  from gatherings where id = gathering_id_param for update;

  if v_host_id is null then
    raise exception 'Gathering not found';
  end if;
  if v_scheduled_at < now() then
    raise exception 'This gathering has already happened';
  end if;

  select id, status into v_my_row_id, v_my_status
  from gathering_interest where gathering_id = gathering_id_param and user_id = v_user_id;

  if v_my_row_id is null then
    raise exception 'You are not part of this gathering';
  end if;

  delete from gathering_interest where id = v_my_row_id;

  -- An approved attendee leaving, or a pending request being withdrawn (a promoted person's held slot), frees a slot.
  if v_my_status in ('approved', 'pending') then
    v_promoted := _promote_from_waitlist(gathering_id_param);
  end if;

  return jsonb_build_object('left', true, 'promoted_user_id', v_promoted->>'user_id', 'promoted_status', v_promoted->>'status');
end;
$function$;

create or replace function public.host_remove_gathering_attendee(interest_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row gathering_interest%rowtype;
  v_host uuid; v_title text; v_scheduled timestamptz;
  v_promoted jsonb; v_service_key text;
begin
  select * into v_row from gathering_interest where id = interest_id_param;
  if not found then raise exception 'Request not found'; end if;
  select host_id, title, scheduled_at into v_host, v_title, v_scheduled
    from gatherings where id = v_row.gathering_id for update;
  if v_host is distinct from auth.uid() then raise exception 'Only the host can do this'; end if;
  if v_scheduled < now() then raise exception 'This gathering has already happened'; end if;

  delete from gathering_interest where id = interest_id_param;

  if v_row.status in ('approved', 'pending') then
    v_promoted := _promote_from_waitlist(v_row.gathering_id);
  end if;

  if v_row.status <> 'approved'
     and coalesce((select notify_planning from profiles where id = v_row.user_id), true) then
    select decrypted_secret into v_service_key from vault.decrypted_secrets where name = 'service_role_key';
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key),
      body := jsonb_build_object(
        'recipient_id', v_row.user_id,
        'title', 'Update on your request',
        'body', 'The host couldn''t approve your request to join "' || v_title || '".',
        'data', jsonb_build_object('type', 'gathering_updated', 'gathering_id', v_row.gathering_id)
      )
    );
  end if;
  return jsonb_build_object('removed', true, 'promoted_user_id', v_promoted->>'user_id', 'promoted_status', v_promoted->>'status');
end;
$fn$;
revoke all on function public.host_remove_gathering_attendee(uuid) from public, anon;
grant execute on function public.host_remove_gathering_attendee(uuid) to authenticated;

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
            else 'The host of "' || gathering_title || '" approved your interest. Start chatting!' end,
          'data', jsonb_build_object('type', 'gathering_approved', 'match_id', new.match_id)
        )
      );
    end if;
  elsif new.status = 'pending' and old.status = 'waitlisted' then
    -- Waitlist promotion on an approval-required gathering: the person moves to the SAME pending state a normal request
    -- has (20270120). Tell the host there is a request to review and tell the person a spot opened up.
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
    select title, host_id into gathering_title, v_host_id from gatherings where id = new.gathering_id;
    if coalesce((select notify_planning from profiles where id = v_host_id), true) then
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
