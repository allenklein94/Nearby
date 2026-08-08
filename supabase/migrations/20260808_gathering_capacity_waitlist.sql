-- Capacity + real waitlist queue for gatherings ("Create 2.0"'s deliberately
-- deferred "How many people?" step, now built per direct user decision —
-- see CLAUDE.md's "Outstanding: Capacity / Waitlist" section for the full
-- design discussion: real waitlist queue (not a display-only cap),
-- auto-promote on a spot opening, applies to both public and host-approval
-- gatherings alike).
--
-- Capacity is a genuine scarcity resource (unlike this app's privacy
-- gates, which are deliberately "RLS wide open, UI/client is the real
-- gate" throughout this schema) — two people joining the literal last
-- spot at once is a real race, so every capacity-aware write below runs
-- inside a SECURITY DEFINER function that locks the gathering row first.

alter table public.gatherings add column capacity integer;
alter table public.gatherings add constraint gatherings_capacity_check check (capacity is null or capacity > 0);
comment on column public.gatherings.capacity is 'Max approved attendees. Null = no limit (default, matches every pre-existing row''s real behavior).';

-- Tighten the existing client-side INSERT policy. It previously allowed a
-- direct client insert to set ANY status value (not just 'pending') for a
-- public gathering, via "(status = 'pending') OR (gathering is_public)" —
-- meaning a client could bypass express_interest_public's own approval
-- logic entirely by inserting status='approved' directly. That was a
-- pre-existing quirk; it becomes a real capacity-bypass exploit now that
-- "approved" is a scarce, capacity-gated status, so it's closed here.
-- The new join_gathering()/leave_gathering() RPCs below are SECURITY
-- DEFINER and bypass RLS entirely, so they're unaffected — this only
-- restricts what a client can insert *directly*.
drop policy if exists "Users can express interest, respecting women-only gatherings" on public.gathering_interest;
create policy "Users can express interest, respecting women-only gatherings"
  on public.gathering_interest for insert
  with check (
    auth.uid() = user_id
    and status = 'pending'
    and not exists (
      select 1 from gatherings g
      where g.id = gathering_interest.gathering_id
        and g.women_only = true
        and not exists (
          select 1 from profiles p
          where p.id = auth.uid()
            and lower(coalesce(p.gender, '')) = any (array['female', 'woman'])
        )
    )
  );

-- The old public-gathering auto-approve RPC is fully superseded by
-- join_gathering() below (which is capacity-aware); nothing else in the
-- schema calls it (checked live via a prosrc search before dropping).
-- Left in place, it would still be a capacity-bypass vector — same
-- reasoning as the RLS tightening above.
drop function if exists public.express_interest_public(uuid);

create or replace function public.join_gathering(gathering_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_host_id uuid;
  v_is_public boolean;
  v_women_only boolean;
  v_capacity integer;
  v_user_id uuid := auth.uid();
  v_gender text;
  v_is_blocked boolean;
  v_approved_count integer;
  v_status text;
  v_new_match_id uuid;
  v_row_count integer;
begin
  -- Locks the gathering row so two concurrent joiners can't both read
  -- "one spot left" and both get approved.
  select host_id, is_public, women_only, capacity into v_host_id, v_is_public, v_women_only, v_capacity
  from gatherings where id = gathering_id_param for update;

  if v_host_id is null then
    raise exception 'Gathering not found';
  end if;
  if v_host_id = v_user_id then
    raise exception 'Cannot express interest in your own gathering';
  end if;
  if v_women_only then
    select gender into v_gender from profiles where id = v_user_id;
    if lower(coalesce(v_gender, '')) not in ('female', 'woman') then
      raise exception 'This gathering is women-only';
    end if;
  end if;
  select exists(
    select 1 from blocks where (blocker_id = v_host_id and blocked_id = v_user_id)
    or (blocker_id = v_user_id and blocked_id = v_host_id)
  ) into v_is_blocked;
  if v_is_blocked then
    raise exception 'Cannot express interest in this gathering';
  end if;

  select count(*) into v_approved_count from gathering_interest
  where gathering_id = gathering_id_param and status = 'approved';

  -- At/over capacity always waitlists, regardless of public/host-approval —
  -- "no spot available" is the same fact either way. Under capacity keeps
  -- today's exact behavior: public auto-approves, host-approval stays
  -- pending for the host to review.
  if v_capacity is not null and v_approved_count >= v_capacity then
    v_status := 'waitlisted';
  elsif v_is_public then
    v_status := 'approved';
  else
    v_status := 'pending';
  end if;

  insert into gathering_interest (gathering_id, user_id, status)
  values (gathering_id_param, v_user_id, v_status)
  on conflict (gathering_id, user_id) do nothing;
  get diagnostics v_row_count = row_count;

  if v_row_count = 0 then
    -- Already had an active request (pending/approved/waitlisted) —
    -- idempotent, return their existing status rather than erroring.
    select status into v_status from gathering_interest
    where gathering_id = gathering_id_param and user_id = v_user_id;
    return jsonb_build_object('status', v_status, 'match_id', null);
  end if;

  if v_status = 'approved' then
    insert into matches (user_a, user_b, source_gathering_id)
    values (least(v_host_id, v_user_id), greatest(v_host_id, v_user_id), gathering_id_param)
    on conflict (user_a, user_b) do update
      set source_gathering_id = gathering_id_param
      where matches.source_gathering_id is null
    returning id into v_new_match_id;
    if v_new_match_id is null then
      select id into v_new_match_id from matches
      where user_a = least(v_host_id, v_user_id) and user_b = greatest(v_host_id, v_user_id);
    end if;
  end if;

  return jsonb_build_object('status', v_status, 'match_id', v_new_match_id);
end;
$function$;

revoke all on function public.join_gathering(uuid) from public, anon;
grant execute on function public.join_gathering(uuid) to authenticated;

-- Rewritten for capacity awareness. Return type changes from uuid to
-- jsonb ({status, match_id}) since approving a pending request can now
-- honestly result in either 'approved' or 'waitlisted' (gathering filled
-- up between the request and the host's review) — the old bare-uuid
-- return had no way to signal that distinction, and the caller needs to
-- know so it can show the host an honest "this gathering is full, added
-- to the waitlist instead" message rather than a false "Approved!".
drop function if exists public.approve_gathering_interest(uuid);
create function public.approve_gathering_interest(interest_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_gathering_id uuid;
  v_interested_user_id uuid;
  v_host_id uuid;
  v_women_only boolean;
  v_capacity integer;
  v_interested_gender text;
  v_new_match_id uuid;
  v_is_blocked boolean;
  v_approved_count integer;
begin
  select gathering_id, user_id into v_gathering_id, v_interested_user_id
  from gathering_interest where id = interest_id;

  select host_id, women_only, capacity into v_host_id, v_women_only, v_capacity
  from gatherings where id = v_gathering_id for update;

  if v_host_id != auth.uid() then
    raise exception 'Only the host can approve interest';
  end if;
  if v_host_id = v_interested_user_id then
    raise exception 'Cannot match with yourself';
  end if;
  if v_women_only then
    select gender into v_interested_gender from profiles where id = v_interested_user_id;
    if lower(coalesce(v_interested_gender, '')) not in ('female', 'woman') then
      raise exception 'This gathering is women-only';
    end if;
  end if;
  select exists(
    select 1 from blocks where (blocker_id = v_host_id and blocked_id = v_interested_user_id)
    or (blocker_id = v_interested_user_id and blocked_id = v_host_id)
  ) into v_is_blocked;
  if v_is_blocked then
    raise exception 'Cannot approve interest from a blocked user';
  end if;

  select count(*) into v_approved_count from gathering_interest
  where gathering_id = v_gathering_id and status = 'approved';

  if v_capacity is not null and v_approved_count >= v_capacity then
    update gathering_interest set status = 'waitlisted' where id = interest_id;
    return jsonb_build_object('status', 'waitlisted', 'match_id', null);
  end if;

  update gathering_interest set status = 'approved' where id = interest_id;
  insert into matches (user_a, user_b, source_gathering_id)
  values (least(v_host_id, v_interested_user_id), greatest(v_host_id, v_interested_user_id), v_gathering_id)
  on conflict (user_a, user_b) do update
    set source_gathering_id = v_gathering_id
    where matches.source_gathering_id is null
  returning id into v_new_match_id;
  if v_new_match_id is null then
    select id into v_new_match_id from matches
    where user_a = least(v_host_id, v_interested_user_id) and user_b = greatest(v_host_id, v_interested_user_id);
  end if;
  return jsonb_build_object('status', 'approved', 'match_id', v_new_match_id);
end;
$function$;

revoke all on function public.approve_gathering_interest(uuid) from public, anon;
grant execute on function public.approve_gathering_interest(uuid) to authenticated;

-- New: the prerequisite this whole mechanic needed but the app never had
-- at all — there was previously no way for anyone to leave a gathering
-- once approved/pending/waitlisted (confirmed live: no decline/leave/
-- remove-attendee RPC or client code existed anywhere). Without this, a
-- waitlist could never actually promote anyone — a spot could never open.
-- Deliberately only allowed before the gathering happens (can't "un-attend"
-- something already in the past) so this can't be used to retroactively
-- erase real attendance history that Momentum/Insights/achievements read.
create or replace function public.leave_gathering(gathering_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_host_id uuid;
  v_capacity integer;
  v_scheduled_at timestamptz;
  v_my_row_id uuid;
  v_my_status text;
  v_promoted_interest_id uuid;
  v_promoted_user_id uuid;
  v_new_match_id uuid;
begin
  select host_id, capacity, scheduled_at into v_host_id, v_capacity, v_scheduled_at
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

  if v_my_status = 'approved' and v_capacity is not null then
    select id into v_promoted_interest_id from gathering_interest
    where gathering_id = gathering_id_param and status = 'waitlisted'
    order by created_at asc
    limit 1
    for update;

    if v_promoted_interest_id is not null then
      update gathering_interest set status = 'approved' where id = v_promoted_interest_id
      returning user_id into v_promoted_user_id;

      insert into matches (user_a, user_b, source_gathering_id)
      values (least(v_host_id, v_promoted_user_id), greatest(v_host_id, v_promoted_user_id), gathering_id_param)
      on conflict (user_a, user_b) do update
        set source_gathering_id = gathering_id_param
        where matches.source_gathering_id is null
      returning id into v_new_match_id;
    end if;
  end if;

  return jsonb_build_object('left', true, 'promoted_user_id', v_promoted_user_id);
end;
$function$;

revoke all on function public.leave_gathering(uuid) from public, anon;
grant execute on function public.leave_gathering(uuid) to authenticated;

-- Extend the existing push-notification trigger to cover the two new
-- status transitions this whole feature introduces, rather than sending
-- pushes manually from inside join_gathering/approve_gathering_interest/
-- leave_gathering — this trigger already fires on every UPDATE to
-- gathering_interest, so it's the single place that already knows how to
-- reach the affected user and respect their notify_matches preference.
create or replace function public.notify_gathering_approved()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  gathering_title text;
  interested_user_wants_notif boolean;
  service_key text;
begin
  if new.status = 'approved' and old.status in ('pending', 'waitlisted') then
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

    select title into gathering_title from gatherings where id = new.gathering_id;
    select notify_matches into interested_user_wants_notif from profiles where id = new.user_id;

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
  elsif new.status = 'waitlisted' and old.status = 'pending' then
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

    select title into gathering_title from gatherings where id = new.gathering_id;
    select notify_matches into interested_user_wants_notif from profiles where id = new.user_id;

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
