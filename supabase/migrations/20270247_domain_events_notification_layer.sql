-- Item 125: notifications are event-driven, not screen-driven.
-- A domain operation (server RPC/trigger) emits ONE canonical event; ONE dispatcher decides, per event, who (if anyone)
-- is notified, with what copy and deep link. Screens never own notification logic. This is not an event bus: events are
-- dispatched synchronously in the same transaction as the domain action (as the direct pushes were), and only the eight
-- registry events exist. Event payloads carry canonical ids only, never copy or screen text.

create table if not exists public.domain_events (
  id bigint generated always as identity primary key,
  type text not null check (type in (
    'GATHERING_CREATED', 'INVITATION_SENT', 'INVITATION_ACCEPTED', 'INVITATION_EXPIRED',
    'BUSINESS_REQUEST_SENT', 'BUSINESS_OFFER_SENT', 'BUSINESS_OFFER_ACCEPTED', 'OFFER_REDEEMED')),
  object_kind text not null,
  object_id uuid not null,
  actor_id uuid,
  source text not null,              -- the domain operation that emitted it (audit fact, never copy)
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists domain_events_object_idx on public.domain_events (object_kind, object_id);
alter table public.domain_events enable row level security;
revoke all on public.domain_events from public, anon, authenticated;

-- What the notification layer decided for each recipient of an event (one row per event x recipient x channel).
create table if not exists public.domain_event_notifications (
  id bigint generated always as identity primary key,
  event_id bigint not null references public.domain_events(id) on delete cascade,
  recipient_id uuid not null,
  channel text not null default 'push' check (channel in ('push')),
  notification_type text not null,
  outcome text not null check (outcome in ('sent', 'muted', 'blocked', 'no_key')),
  created_at timestamptz not null default now(),
  unique (event_id, recipient_id, channel)
);
alter table public.domain_event_notifications enable row level security;
revoke all on public.domain_event_notifications from public, anon, authenticated;

-- The ONE place a push leaves the database (vault key + send-push). Returns false when no key is configured.
create or replace function public._send_push(recipient_id_param uuid, title_param text, body_param text, data_param jsonb)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_key is null then
    return false;
  end if;
  perform net.http_post(
    url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object('recipient_id', recipient_id_param, 'title', title_param, 'body', body_param, 'data', data_param)
  );
  return true;
end;
$function$;
revoke all on function public._send_push(uuid, text, text, jsonb) from public, anon, authenticated;

-- One recipient of one event: dedupe, block, preference/mute, then send. Returns true only when a push was sent.
-- mute_ok_param is the recipient's own preference for this category, evaluated by the handler.
create or replace function public._notify_event_recipient(
  event_id_param bigint, recipient_id_param uuid, mute_ok_param boolean,
  title_param text, body_param text, data_param jsonb)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor uuid;
  v_outcome text;
begin
  if recipient_id_param is null then
    return false;
  end if;
  if exists (select 1 from domain_event_notifications
             where event_id = event_id_param and recipient_id = recipient_id_param and channel = 'push') then
    return false;  -- this event already notified this person
  end if;
  select actor_id into v_actor from domain_events where id = event_id_param;
  if v_actor is not null and v_actor <> recipient_id_param and exists (
       select 1 from blocks
       where (blocker_id = v_actor and blocked_id = recipient_id_param)
          or (blocker_id = recipient_id_param and blocked_id = v_actor)) then
    v_outcome := 'blocked';
  elsif not coalesce(mute_ok_param, true) then
    v_outcome := 'muted';
  elsif public._send_push(recipient_id_param, title_param, body_param, data_param) then
    v_outcome := 'sent';
  else
    v_outcome := 'no_key';
  end if;
  insert into domain_event_notifications (event_id, recipient_id, channel, notification_type, outcome)
  values (event_id_param, recipient_id_param, 'push', coalesce(data_param->>'type', 'unknown'), v_outcome);
  return v_outcome = 'sent';
end;
$function$;
revoke all on function public._notify_event_recipient(bigint, uuid, boolean, text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Handlers: event -> notification policy. Each reproduces the pre-item-125 push exactly (recipients, conditions,
-- wording, deep link); the copy lives here, never in the event.
-- ---------------------------------------------------------------------------------------------------------------

-- GATHERING_CREATED: "This matches you" to nearby people who declared the gathering's category (was notify_matching_things_to_do).
create or replace function public._on_gathering_created(e public.domain_events)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  g record;
  v_candidate record;
  v_lat double precision;
  v_lng double precision;
  v_distance_miles double precision;
  v_cap integer;
  v_sent_today integer;
  v_today_in_tz date;
  v_scheduled_local timestamp;
  v_when_phrase text;
begin
  select * into g from gatherings where id = e.object_id;
  if not found then return; end if;
  if g.visibility <> 'everyone' or coalesce(g.is_public, false) is not true or g.discoverable is not true or g.interest_tag is null
     or g.precise_lat is null or g.precise_lng is null then
    return;
  end if;

  for v_candidate in
    select p.id, coalesce(p.timezone, 'UTC') as tz, pr.area,
           p.notify_things_to_do_frequency, p.notify_things_to_do_max_distance_miles,
           p.notify_things_to_do_time_pref
    from profiles p
    join push_target_areas pr on pr.user_id = p.id
    where p.id <> g.host_id
      and coalesce(p.notify_discovery, true) = true
      and pr.reported_at > now() - interval '1 hour'
      and p.interests @> array[g.interest_tag]
      and (p.notify_things_to_do_categories is null or g.interest_tag = any(p.notify_things_to_do_categories))
  loop
    v_lat := split_part(v_candidate.area, ',', 1)::double precision;
    v_lng := split_part(v_candidate.area, ',', 2)::double precision;

    v_distance_miles := 3958.8 * acos(least(1.0, greatest(-1.0,
      cos(radians(v_lat)) * cos(radians(g.precise_lat)) * cos(radians(g.precise_lng) - radians(v_lng)) +
      sin(radians(v_lat)) * sin(radians(g.precise_lat))
    )));
    if v_candidate.notify_things_to_do_max_distance_miles is not null
       and v_distance_miles > v_candidate.notify_things_to_do_max_distance_miles then
      continue;
    end if;

    v_scheduled_local := g.scheduled_at at time zone v_candidate.tz;
    if v_candidate.notify_things_to_do_time_pref = 'evenings_weekends'
       and extract(dow from v_scheduled_local) not in (0, 6)
       and extract(hour from v_scheduled_local) < 17 then
      continue;
    end if;

    v_today_in_tz := (now() at time zone v_candidate.tz)::date;
    select count(*) into v_sent_today from recommendation_push_log
      where user_id = v_candidate.id and source_type = 'gathering'
        and (sent_at at time zone v_candidate.tz)::date = v_today_in_tz;
    v_cap := case v_candidate.notify_things_to_do_frequency
      when 'few_per_day' then 3
      when 'more_often' then 8
      else 20 -- 'as_they_happen' -- still a hard safety ceiling, not literally unlimited
    end;
    if v_sent_today >= v_cap then
      continue;
    end if;

    v_when_phrase := case
      when v_scheduled_local::date = v_today_in_tz and extract(hour from v_scheduled_local) >= 17 then 'tonight'
      when v_scheduled_local::date = v_today_in_tz then 'today'
      when v_scheduled_local::date = v_today_in_tz + 1 then 'tomorrow'
      when extract(dow from v_scheduled_local) in (0, 6) and v_scheduled_local::date <= v_today_in_tz + 7 then 'this weekend'
      else to_char(v_scheduled_local, 'FMDay')
    end;

    if public._notify_event_recipient(e.id, v_candidate.id, true,
         '🎯 This matches you',
         '"' || g.title || '" is happening ' || v_when_phrase || ' and you like ' || g.interest_tag || '.',
         jsonb_build_object('type', 'recommended_gathering', 'gathering_id', g.id)) then
      insert into recommendation_push_log (user_id, source_type, source_id) values (v_candidate.id, 'gathering', g.id);
    end if;
  end loop;
end;
$function$;

-- INVITATION_SENT: the gathering-invite push, only for the invite_friend_to_gathering path (the pre-item-125 behavior;
-- send_social_invite never pushed). Record only otherwise.
create or replace function public._on_invitation_sent(e public.domain_events)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_invite record;
  v_inviter_name text;
  v_title text;
begin
  if e.source <> 'invite_friend_to_gathering' then
    return;
  end if;
  select * into v_invite from social_invites where id = e.object_id;
  if not found or v_invite.invite_type <> 'gathering' then return; end if;
  select display_name into v_inviter_name from profiles where id = v_invite.inviter_id;
  select title into v_title from gatherings where id = v_invite.target_id;
  perform public._notify_event_recipient(e.id, v_invite.invitee_id,
    coalesce((select notify_planning from profiles where id = v_invite.invitee_id), true),
    coalesce(v_inviter_name, 'A friend') || ' invited you to a gathering',
    coalesce(v_title, 'Check it out') || ' — tap to see the details.',
    jsonb_build_object('type', 'gathering_invite', 'gathering_id', v_invite.target_id));
end;
$function$;

-- BUSINESS_REQUEST_SENT: one request reached one business (a pending offer row). Directed = immediate push;
-- fan-out = immediate only when urgent, else it waits for the hourly digest (send_business_opportunity_digests).
create or replace function public._on_business_request_sent(e public.domain_events)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  o record;
  v_profile uuid;
  v_directed boolean;
begin
  select * into o from business_request_offers where id = e.object_id;
  if not found then return; end if;
  v_directed := coalesce((e.payload->>'directed')::boolean, false);
  if not v_directed and not public._opportunity_is_urgent(o.request_id) then
    return;
  end if;
  for v_profile in select id from profiles where managed_partner_id = o.partner_id loop
    perform public._notify_event_recipient(e.id, v_profile,
      coalesce((select notify_business from profiles where id = v_profile), true),
      case when v_directed then 'A customer asked for your business' else 'New opportunity nearby!' end,
      'New request: ' || public.business_safe_request_summary(o.request_id),
      jsonb_build_object('type', 'business_opportunity_received', 'request_id', o.request_id));
  end loop;
end;
$function$;

-- BUSINESS_OFFER_SENT: an offer now exists for the customer. A business's own reply notifies the customer; an offer made
-- automatically from the business's standing supply (availability, package, policy, AI policy) tells the business instead.
create or replace function public._on_business_offer_sent(e public.domain_events)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  o record;
  v_requester uuid;
  v_title text;
  v_body text;
  v_label text;
  v_profile uuid;
  v_summary text;
begin
  select * into o from business_request_offers where id = e.object_id;
  if not found then return; end if;

  if e.source in ('submit_business_offer', 'admin_review_business_content_screening') then
    select requester_id into v_requester from business_requests where id = o.request_id;
    select p.title, p.body into v_title, v_body from public._business_reply_push(o.id) p;
    perform public._notify_event_recipient(e.id, v_requester,
      coalesce((select notify_business from profiles where id = v_requester), true),
      v_title, v_body,
      jsonb_build_object('type', 'business_offer_received', 'request_id', o.request_id, 'offer_id', o.id));
    return;
  end if;

  v_summary := public.business_safe_request_summary(o.request_id);
  if e.source = 'match_availability' then
    select title into v_label from business_availability where id = (e.payload->>'availability_id')::uuid;
    v_title := 'Your availability was just matched!';
    v_body := '"' || v_label || '" matches a new request: ' || coalesce(v_summary, 'a new request');
  elsif e.source = 'match_package' then
    select name into v_label from business_occasion_packages where id = (e.payload->>'package_id')::uuid;
    v_title := 'Your occasion package was just matched!';
    v_body := '"' || v_label || '" matches a new request: ' || coalesce(v_summary, 'a new request');
  elsif e.source = 'match_policy' then
    v_title := 'Auto-accepted a new request!';
    v_body := 'Your fulfillment policy auto-accepted: ' || coalesce(v_summary, 'a new request');
  elsif e.source = 'ai_auto_respond' then
    select name into v_label from business_ai_policies where id = (e.payload->>'policy_id')::uuid;
    v_title := 'Your AI Automation auto-responded!';
    v_body := 'Policy "' || v_label || '" auto-sent an offer for: ' || v_summary;
  else
    return;
  end if;

  for v_profile in select id from profiles where managed_partner_id = o.partner_id loop
    perform public._notify_event_recipient(e.id, v_profile,
      -- the package match never honored the business mute (pre-item-125 behavior, kept exactly)
      e.source = 'match_package' or coalesce((select notify_business from profiles where id = v_profile), true),
      v_title, v_body,
      jsonb_build_object('type', 'business_opportunity_received', 'request_id', o.request_id));
  end loop;
end;
$function$;

-- BUSINESS_OFFER_ACCEPTED: the business learns its offer was taken; a direct accept also confirms to the customer and
-- the other people on the plan; a group-plan accept confirms to every accepted participant.
create or replace function public._on_business_offer_accepted(e public.domain_events)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  o record;
  r record;
  v_profile uuid;
  v_partner_name text;
  v_occ_type text;
  v_occ_who text;
  v_title text;
  v_body text;
  v_proposal uuid;
  v_uid uuid;
begin
  select * into o from business_request_offers where id = e.object_id;
  if not found then return; end if;
  select * into r from business_requests where id = o.request_id;

  for v_profile in select id from profiles where managed_partner_id = o.partner_id loop
    perform public._notify_event_recipient(e.id, v_profile,
      coalesce((select notify_business from profiles where id = v_profile), true),
      'Your offer was accepted!',
      'A customer accepted your offer: ' || coalesce(public.business_safe_request_summary(r.id), 'a request'),
      jsonb_build_object('type', 'business_offer_accepted', 'request_id', r.id, 'offer_id', o.id));
  end loop;

  if e.source = 'accept_business_offer' then
    select name into v_partner_name from brand_partners where id = o.partner_id;
    select occasion_type, who_for_name into v_occ_type, v_occ_who from _occasion_context_for_business_request(r.id);
    if v_occ_type is not null then
      v_title := _occasion_emoji(v_occ_type) || ' Reservation Confirmed!';
      if v_occ_who is not null then
        v_body := 'Your reservation for ' || v_occ_who || '''s ' || _occasion_noun(v_occ_type) || ' is confirmed!';
      else
        v_body := 'Your ' || _occasion_noun(v_occ_type) || ' reservation is confirmed!';
      end if;
    else
      v_title := '✅ Reservation Confirmed!';
      v_body := 'Your reservation' || case when v_partner_name is not null then ' with ' || v_partner_name else '' end || ' is confirmed!';
    end if;
    perform public._notify_event_recipient(e.id, r.requester_id,
      coalesce((select notify_business from profiles where id = r.requester_id), true),
      v_title, v_body,
      jsonb_build_object('type', 'business_reservation_confirmed', 'request_id', r.id, 'offer_id', o.id));
    -- Item 90: everyone else on the plan learns it's confirmed too.
    perform _notify_other_plan_participants(r.id, r.requester_id, 'plan_confirmed', v_title, v_body,
      jsonb_build_object('offer_id', o.id));

  elsif e.source = 'confirm_group_plan_offer' then
    v_proposal := (e.payload->>'proposal_id')::uuid;
    select occasion_type, who_for_name into v_occ_type, v_occ_who from _occasion_context_for_business_request(r.id);
    if v_occ_type is not null then
      v_title := _occasion_emoji(v_occ_type) || ' Reservation Confirmed!';
      if v_occ_who is not null then
        v_body := 'Your group''s reservation for ' || v_occ_who || '''s ' || _occasion_noun(v_occ_type) || ' is confirmed!';
      else
        v_body := 'Everyone confirmed -- your group''s ' || lower(_occasion_noun(v_occ_type)) || ' reservation is locked in.';
      end if;
    else
      v_title := 'Group plan reservation confirmed!';
      v_body := 'Everyone confirmed -- your group plan reservation is locked in.';
    end if;
    for v_uid in select user_id from group_plan_participants where proposal_id = v_proposal and status = 'accepted' loop
      perform public._notify_event_recipient(e.id, v_uid,
        coalesce((select notify_planning from profiles where id = v_uid), true),
        v_title, v_body,
        jsonb_build_object('type', 'group_plan_reservation_confirmed', 'proposal_id', v_proposal, 'offer_id', o.id));
    end loop;
  end if;
end;
$function$;

-- The ONE dispatcher. INVITATION_ACCEPTED / INVITATION_EXPIRED / OFFER_REDEEMED are recorded only (owner decision 4).
create or replace function public._dispatch_domain_event(event_id_param bigint)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  e public.domain_events;
begin
  select * into e from domain_events where id = event_id_param;
  if not found then return; end if;
  case e.type
    when 'GATHERING_CREATED' then perform public._on_gathering_created(e);
    when 'INVITATION_SENT' then perform public._on_invitation_sent(e);
    when 'BUSINESS_REQUEST_SENT' then perform public._on_business_request_sent(e);
    when 'BUSINESS_OFFER_SENT' then perform public._on_business_offer_sent(e);
    when 'BUSINESS_OFFER_ACCEPTED' then perform public._on_business_offer_accepted(e);
    else null;  -- recorded, no notification
  end case;
end;
$function$;

-- Emit: record the event once (idempotency key) and dispatch it. A repeat of the same key does nothing.
create or replace function public._emit_event(
  type_param text, object_kind_param text, object_id_param uuid, actor_id_param uuid,
  source_param text, payload_param jsonb, idempotency_key_param text)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id bigint;
begin
  insert into domain_events (type, object_kind, object_id, actor_id, source, payload, idempotency_key)
  values (type_param, object_kind_param, object_id_param, actor_id_param, source_param,
          coalesce(payload_param, '{}'::jsonb), idempotency_key_param)
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  if v_id is not null then
    perform public._dispatch_domain_event(v_id);
  end if;
  return v_id;
end;
$function$;

revoke all on function public._on_gathering_created(public.domain_events) from public, anon, authenticated;
revoke all on function public._on_invitation_sent(public.domain_events) from public, anon, authenticated;
revoke all on function public._on_business_request_sent(public.domain_events) from public, anon, authenticated;
revoke all on function public._on_business_offer_sent(public.domain_events) from public, anon, authenticated;
revoke all on function public._on_business_offer_accepted(public.domain_events) from public, anon, authenticated;
revoke all on function public._dispatch_domain_event(bigint) from public, anon, authenticated;
revoke all on function public._emit_event(text, text, uuid, uuid, text, jsonb, text) from public, anon, authenticated;

-- GATHERING_CREATED is emitted for every new gathering (eligibility is the handler's job). Same trigger name, so its
-- place among the gathering insert triggers is unchanged.
create or replace function public.emit_gathering_created()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public._emit_event('GATHERING_CREATED', 'gathering', new.id, new.host_id, 'gathering_insert',
    jsonb_build_object('gathering_id', new.id), 'GATHERING_CREATED:' || new.id);
  return new;
end;
$function$;
revoke all on function public.emit_gathering_created() from public, anon, authenticated;
drop trigger if exists on_gathering_created_notify_things_to_do on public.gatherings;
create trigger on_gathering_created_notify_things_to_do after insert on public.gatherings
  for each row execute function public.emit_gathering_created();
drop function if exists public.notify_matching_things_to_do();

-- ---------------------------------------------------------------------------------------------------------------
-- Domain operations now emit events instead of pushing directly (bodies patched from their live definitions).
-- ---------------------------------------------------------------------------------------------------------------
-- invite_friend_to_gathering
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
  v_invite_id uuid;
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
  on conflict (inviter_id, invitee_id, invite_type, target_id) where status = 'pending' do nothing
  returning id into v_invite_id;

  -- Item 125: the invitation is an event; the notification layer decides the push. An invite that was already
  -- pending creates no new invitation, so nothing is sent again.
  if v_invite_id is not null then
    perform public._emit_event('INVITATION_SENT', 'social_invite', v_invite_id, auth.uid(), 'invite_friend_to_gathering',
      jsonb_build_object('invite_id', v_invite_id, 'gathering_id', gathering_id_param, 'invitee_id', friend_id_param),
      'INVITATION_SENT:' || v_invite_id);
  end if;
end;
$function$;

-- send_social_invite
CREATE OR REPLACE FUNCTION public.send_social_invite(invite_type_param text, target_id_param uuid, invitee_id_param uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invite_id uuid;
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
  on conflict (inviter_id, invitee_id, invite_type, target_id) where status = 'pending' do nothing
  returning id into v_invite_id;

  -- Item 125: recorded as INVITATION_SENT (this path never pushed; the notification layer keeps it that way).
  if v_invite_id is not null then
    perform public._emit_event('INVITATION_SENT', 'social_invite', v_invite_id, auth.uid(), 'send_social_invite',
      jsonb_build_object('invite_id', v_invite_id, 'invite_type', invite_type_param, 'target_id', target_id_param,
                         'invitee_id', invitee_id_param),
      'INVITATION_SENT:' || v_invite_id);
  end if;
end;
$function$;

-- respond_to_social_invite
CREATE OR REPLACE FUNCTION public.respond_to_social_invite(invite_id_param uuid, accept boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_type text;
  v_target uuid;
  v_past boolean := false;
begin
  select invite_type, target_id into v_type, v_target
  from social_invites
  where id = invite_id_param and invitee_id = auth.uid() and status = 'pending';

  if not found then
    raise exception 'Invite not found or already responded to';
  end if;

  if v_type = 'gathering' then
    select scheduled_at < now() into v_past from gatherings where id = v_target;
    v_past := coalesce(v_past, false);
  end if;

  if v_past and accept then
    raise exception 'This invitation has expired: the gathering has already happened';
  end if;

  update social_invites
  set status = case
        when v_past then 'expired'
        when accept then 'accepted'
        else 'declined'
      end,
      responded_at = now()
  where id = invite_id_param and invitee_id = auth.uid() and status = 'pending';

  -- Item 125: recorded only (no push for acceptance or expiry, owner decision). A decline is not a registry event.
  if v_past then
    perform public._emit_event('INVITATION_EXPIRED', 'social_invite', invite_id_param, auth.uid(), 'respond_to_social_invite',
      jsonb_build_object('invite_id', invite_id_param), 'INVITATION_EXPIRED:' || invite_id_param);
  elsif accept then
    perform public._emit_event('INVITATION_ACCEPTED', 'social_invite', invite_id_param, auth.uid(), 'respond_to_social_invite',
      jsonb_build_object('invite_id', invite_id_param), 'INVITATION_ACCEPTED:' || invite_id_param);
  end if;
end;
$function$;

-- _business_request_fanout
CREATE OR REPLACE FUNCTION public._business_request_fanout(request_id_param uuid, latitude_param double precision, longitude_param double precision, radius_miles_param double precision, category_filter_param text[] DEFAULT NULL::text[], business_major_filter_param text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_notified_count integer := 0;
  v_req_attributes text[];
  v_req_dietary text[];
  v_req_cuisine text;
  v_req_occasion text;
  v_req_category text;
  v_req_group text;
  v_req_party integer;
  v_children boolean;
  v_pets boolean;
  v_outdoor boolean;
  v_consider double precision;
  v_cands jsonb;
  v_decision bigint;
  service_key text;
  v_row record;
  v_managing_profiles uuid[];
  i integer;
begin
  select attributes, cuisine, occasion, category, party_size, dietary
    into v_req_attributes, v_req_cuisine, v_req_occasion, v_req_category, v_req_party, v_req_dietary
  from business_requests where id = request_id_param;
  -- Category-aware routing (20270130): a request whose category maps to a group only reaches businesses in that
  -- group (declared tags or major). No category / unmapped category = unfiltered, as before. Deterministic, no AI.
  v_req_group := public.request_category_group(v_req_category);
  -- the same request facts _business_declines_request derives (used only to name the reason, never to decide)
  v_children := coalesce(v_req_attributes, '{}') && array['kid_friendly', 'kid_menu', 'family_seating', 'stroller_friendly'];
  v_pets := coalesce(v_req_attributes, '{}') && array['dog_friendly', 'pet_friendly'];
  v_outdoor := 'outdoor_seating' = any(coalesce(v_req_attributes, '{}'));
  v_consider := least(greatest(radius_miles_param * 2, radius_miles_param + 10), 100);
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  with considered as (
    select p.id, p.attributes, p.dietary_options, p.cuisine, p.offered_occasions, p.max_group_size,
           p.private_room_capacity, p.outdoor_capacity,
           (3958.8 * acos(least(1.0, greatest(-1.0,
              cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
              sin(radians(latitude_param)) * sin(radians(p.latitude)))))) as distance_miles,
           ((category_filter_param is null or p.subcategory = any(category_filter_param) or p.categories && category_filter_param)
             and (business_major_filter_param is null or p.category = business_major_filter_param)
             and (v_req_group is null or public.business_in_category_group(p.id, v_req_group))) as cat_ok,
           -- item 86: a business that declared something this request conflicts with is never routed it
           public._business_declines_request(p.id, request_id_param) as declines,
           (v_req_party is not null and p.max_group_size is not null and p.max_group_size < v_req_party) as cap_small,
           (public._business_declines(p.id, null, v_children, v_pets, v_outdoor, false, false) is not null) as other_conflict,
           -- item 116 step 2: known closed at the requested time (declared hours / temporary closure), with no live posting covering it
           public._business_closed_for_request(p.id, request_id_param) as closed_then,
           -- item 116 check 7: the request's per-person budget is below the business's declared minimum spend (both known)
           public._business_below_min_spend(p.id, request_id_param) as below_min
    from brand_partners p
    where p.active = true and p.latitude is not null and p.longitude is not null
  ),
  near as (select * from considered where distance_miles <= v_consider),
  reputation as (
    select partner_id, count(*) as total_opportunities,
           round(100.0 * count(*) filter (where status = 'completed')
                 / nullif(count(*) filter (where status in ('accepted', 'completed')), 0), 1) as completion_rate
    from business_request_offers group by partner_id
  ),
  scored as (
    select e.*, r.total_opportunities, r.completion_rate,
      -- item 80: a business whose DECLARED largest group is below the party size goes last (strongly de-prioritized, not removed)
      -- item 81: or the space the request asks for (private room / outdoor area, only while that capability is declared) is too small
      (v_req_party is not null and (
        (e.max_group_size is not null and e.max_group_size < v_req_party)
        or ('private_dining' = any(coalesce(v_req_attributes, '{}')) and 'private_dining' = any(coalesce(e.attributes, '{}'))
            and e.private_room_capacity is not null and e.private_room_capacity < v_req_party)
        or ('outdoor_seating' = any(coalesce(v_req_attributes, '{}')) and 'outdoor_seating' = any(coalesce(e.attributes, '{}'))
            and e.outdoor_capacity is not null and e.outdoor_capacity < v_req_party))) as k_deprio,
      -- a business that explicitly says it offers this occasion is routed the request first
      (v_req_occasion is not null and v_req_occasion = any(e.offered_occasions)) as k_occ,
      -- a business that serves the exact requested tag (a coffee shop for a coffee request) goes ahead of group-only matches
      (v_req_category is not null and v_req_category = any(public.business_served_tags(e.id))) as k_exact,
      -- item 80: a declared largest group that covers the party goes ahead of an unknown one
      (v_req_party is not null and (
        (e.max_group_size is not null and e.max_group_size >= v_req_party)
        or ('private_dining' = any(coalesce(v_req_attributes, '{}')) and 'private_dining' = any(coalesce(e.attributes, '{}'))
            and e.private_room_capacity is not null and e.private_room_capacity >= v_req_party)
        or ('outdoor_seating' = any(coalesce(v_req_attributes, '{}')) and 'outdoor_seating' = any(coalesce(e.attributes, '{}'))
            and e.outdoor_capacity is not null and e.outdoor_capacity >= v_req_party))) as k_fits,
      -- item 88: a business that declared every dietary need of the request goes ahead of one that did not say
      (cardinality(coalesce(v_req_dietary, '{}')) > 0 and coalesce(e.dietary_options, '{}') @> v_req_dietary) as k_diet,
      (cardinality(array(select unnest(coalesce(e.attributes, '{}')) intersect select unnest(coalesce(v_req_attributes, '{}'))))
        + (case when v_req_cuisine is not null and e.cuisine = v_req_cuisine then 1 else 0 end)) as k_overlap,
      -- item 116 check 6: the request clearly matches something the business said it wants more of (rank only, never eligibility)
      public._business_wants_request(e.id, request_id_param) as k_want,
      (r.total_opportunities is not null and r.total_opportunities >= 5) as k_established
    from near e
    left join reputation r on r.partner_id = e.id
    where e.cat_ok and not e.declines and not e.closed_then and not e.below_min and e.distance_miles <= radius_miles_param
  ),
  ranked as (
    select s.*, row_number() over (order by
      s.k_deprio asc, s.k_occ desc, s.k_exact desc, s.k_fits desc, s.k_diet desc, s.k_overlap desc, s.k_want desc, s.k_established desc,
      s.completion_rate desc nulls last, s.distance_miles asc, s.id asc) as rn
    from scored s
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', n.id, 'distance', round(n.distance_miles::numeric, 2), 'rn', k.rn,
      'reasons', array(select x from unnest(array[
          case when n.distance_miles > radius_miles_param then 'outside_geo_range' end,
          case when not n.cat_ok then 'wrong_category' end,
          case when n.declines and (n.other_conflict or not n.cap_small) then 'restriction_conflict' end,
          case when n.declines and n.cap_small then 'capacity_too_small' end,
          case when n.closed_then then 'unavailable' end,  -- the audit's existing code for this
          case when n.below_min then 'below_minimum_spend' end,
          case when k.rn > 10 then 'below_routing_cutoff' end]) x where x is not null),
      'signals', array(select x from unnest(array[
          case when k.k_occ then 'occasion_offered' end,
          case when k.k_exact then 'exact_tag' end,
          case when k.k_fits then 'group_size_fits' end,
          case when k.k_deprio then 'deprioritized_size' end,
          case when k.k_diet then 'dietary_all_declared' end,
          case when k.k_overlap > 0 then 'attribute_match' end,
          case when k.k_want then 'wants_more' end,
          case when k.k_established then 'established_record' end]) x where x is not null),
      'sort_key', case when k.id is not null then jsonb_build_object(
          'deprioritized_size', k.k_deprio, 'occasion_offered', k.k_occ, 'exact_tag', k.k_exact, 'group_size_fits', k.k_fits,
          'dietary_all_declared', k.k_diet, 'attribute_overlap', k.k_overlap, 'wants_more', k.k_want, 'established_record', k.k_established,
          'completion_rate', k.completion_rate, 'distance_miles', round(k.distance_miles::numeric, 2)) end,
      'in_range', n.distance_miles <= radius_miles_param) order by k.rn nulls last, n.distance_miles), '[]'::jsonb)
  into v_cands
  from near n left join ranked k on k.id = n.id;

  perform set_config('app.routing_path', 'fanout', true);
  for v_row in
    insert into business_request_offers (request_id, partner_id)
    select request_id_param, (c->>'id')::uuid
    from jsonb_array_elements(v_cands) c
    where (c->>'rn')::int <= 10
    order by (c->>'rn')::int
    returning id, partner_id
  loop
    v_notified_count := v_notified_count + 1;

    -- Item 125: one BUSINESS_REQUEST_SENT per business reached; the notification layer decides urgent push vs digest.
    perform public._emit_event('BUSINESS_REQUEST_SENT', 'business_request_offer', v_row.id,
      (select requester_id from business_requests where id = request_id_param), 'fanout',
      jsonb_build_object('request_id', request_id_param, 'partner_id', v_row.partner_id, 'offer_id', v_row.id, 'directed', false),
      'BUSINESS_REQUEST_SENT:' || v_row.id);
  end loop;
  perform set_config('app.routing_path', '', true);

  -- The audit: never blocks routing. A failure is recorded and routing continues unchanged.
  begin
    insert into routing_decisions (request_id, path, rules_version, request_radius_miles, consideration_radius_miles,
                                   request_snapshot, considered_count, in_range_count, eligible_count, chosen_count)
    values (request_id_param, 'fanout', _routing_rules_version('fanout'), radius_miles_param, v_consider,
            _routing_request_snapshot(request_id_param) || jsonb_build_object(
              'category_filter', category_filter_param, 'major_filter', business_major_filter_param),
            jsonb_array_length(v_cands),
            (select count(*) from jsonb_array_elements(v_cands) c where (c->>'in_range')::boolean),
            (select count(*) from jsonb_array_elements(v_cands) c where c->>'rn' is not null),
            v_notified_count)
    returning id into v_decision;
    insert into routing_candidates (decision_id, partner_id, outcome, rank, primary_reason, reason_codes, signals, sort_key, distance_miles)
    select v_decision, (c->>'id')::uuid,
           case when (c->>'rn')::int <= 10 then 'chosen' else 'excluded' end,
           (c->>'rn')::int,
           case when (c->>'rn')::int <= 10 then null else c->'reasons'->>0 end,
           case when (c->>'rn')::int <= 10 then '{}'::text[] else array(select jsonb_array_elements_text(c->'reasons')) end,
           array(select jsonb_array_elements_text(c->'signals')),
           c->'sort_key', (c->>'distance')::numeric
    from jsonb_array_elements(v_cands) c;
  exception when others then
    perform _routing_record_failure(request_id_param, 'fanout', sqlerrm);
  end;

  return v_notified_count;
end;
$function$;

-- _route_request_to_partner_core
CREATE OR REPLACE FUNCTION public._route_request_to_partner_core(request_id_param uuid, partner_id_param uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_offer_id uuid;
  v_profile uuid;
  service_key text;
begin
  if not exists (select 1 from brand_partners where id = partner_id_param and active = true) then
    raise exception 'That business could not be found';
  end if;
  insert into business_request_offers (request_id, partner_id, is_directed)
  values (request_id_param, partner_id_param, true)
  on conflict (request_id, partner_id) do nothing
  returning id into v_offer_id;
  if v_offer_id is not null then
    -- Item 125: a request addressed to this one business.
    perform public._emit_event('BUSINESS_REQUEST_SENT', 'business_request_offer', v_offer_id,
      (select requester_id from business_requests where id = request_id_param), 'route_request_to_partner',
      jsonb_build_object('request_id', request_id_param, 'partner_id', partner_id_param, 'offer_id', v_offer_id, 'directed', true),
      'BUSINESS_REQUEST_SENT:' || v_offer_id || ':directed');
  end if;
  return v_offer_id;
end;
$function$;

-- _route_gathering_to_partner_core
CREATE OR REPLACE FUNCTION public._route_gathering_to_partner_core(gathering_id_param uuid, partner_id_param uuid, notify_param boolean DEFAULT true)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_g record;
  v_request_id uuid;
  v_party integer;
  v_expires timestamptz;
  v_offer_id uuid;
  v_profile uuid;
  service_key text;
  v_local_date date;
  v_local_time time;
begin
  select id, host_id, scheduled_at, precise_lat, precise_lng, interest_tag into v_g
  from gatherings where id = gathering_id_param;
  if v_g.id is null or v_g.precise_lat is null or v_g.precise_lng is null or v_g.scheduled_at < now() then
    return null;
  end if;
  if not exists (select 1 from brand_partners where id = partner_id_param and active = true) then
    return null;
  end if;

  select id into v_request_id from business_requests
  where gathering_id = gathering_id_param and status = 'open'
  order by created_at desc limit 1;

  if v_request_id is null then
    v_party := public._gathering_party_size(gathering_id_param);
    select local_date, local_time into v_local_date, v_local_time from public._gathering_local_when(v_g.scheduled_at, v_g.host_id);
    v_expires := least(v_g.scheduled_at, now() + interval '30 days');
    if v_expires < now() + interval '1 hour' then v_expires := now() + interval '1 hour'; end if;
    insert into business_requests (
      requester_id, raw_text, category, party_size, date, time_window_start, latitude, longitude,
      radius_miles, expires_at, gathering_id, attributes
    ) values (
      v_g.host_id,
      case when v_g.interest_tag is not null then 'A ' || v_g.interest_tag || ' gathering looking for a place to go'
           else 'A gathering looking for a place to go' end,
      v_g.interest_tag, v_party, v_local_date, v_local_time, v_g.precise_lat, v_g.precise_lng,
      15, v_expires, gathering_id_param, public._gathering_request_attributes(gathering_id_param)
    ) returning id into v_request_id;
  end if;

  insert into business_request_offers (request_id, partner_id, is_directed)
  values (v_request_id, partner_id_param, true)
  on conflict (request_id, partner_id) do update
    set is_directed = true
    where business_request_offers.is_directed = false and business_request_offers.status = 'pending'
  returning id into v_offer_id;

  if v_offer_id is not null and notify_param then
    -- Item 125: the gathering's host asked this one business.
    perform public._emit_event('BUSINESS_REQUEST_SENT', 'business_request_offer', v_offer_id, v_g.host_id, 'route_gathering_to_partner',
      jsonb_build_object('request_id', v_request_id, 'partner_id', partner_id_param, 'offer_id', v_offer_id,
                         'gathering_id', gathering_id_param, 'directed', true),
      'BUSINESS_REQUEST_SENT:' || v_offer_id || ':directed');
  end if;

  return v_request_id;
end;
$function$;

-- _match_request_to_availability_core
CREATE OR REPLACE FUNCTION public._match_request_to_availability_core(request_id_param uuid, latitude_param double precision, longitude_param double precision, radius_miles_param double precision, category_param text, date_param date, time_window_start_param time without time zone, time_window_end_param time without time zone, preferred_availability_id_param uuid DEFAULT NULL::uuid, party_size_param integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_new_count integer := 0;
  v_raw_text text;
  service_key text;
  v_avail record;
  v_preferred record;
  v_already_offered boolean;
  v_managing_profiles uuid[];
  i integer;
begin
  select raw_text into v_raw_text from business_requests where id = request_id_param;

  if preferred_availability_id_param is not null then
    select ba.*, p.latitude as partner_lat, p.longitude as partner_lng
    into v_preferred
    from business_availability ba
    join brand_partners p on p.id = ba.partner_id and p.active = true and not public._business_declines_request(p.id, request_id_param) and not public._business_below_min_spend(p.id, request_id_param)
    where ba.id = preferred_availability_id_param
    and ba.status = 'active'
    and ba.ends_at > now()
    and (ba.remaining_capacity is null or party_size_param is null or ba.remaining_capacity >= party_size_param)
    and p.latitude is not null and p.longitude is not null
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= radius_miles_param;

    if found then
      select exists(
        select 1 from business_request_offers
        where request_id = request_id_param and partner_id = v_preferred.partner_id
      ) into v_already_offered;

      insert into business_request_offers (request_id, partner_id, offer_type, offer_description, offer_price, availability_id, status, responded_at)
      values (request_id_param, v_preferred.partner_id, v_preferred.offer_type, coalesce(v_preferred.description, v_preferred.title), v_preferred.price, v_preferred.id, 'offered', now())
      on conflict (request_id, partner_id) do update
        set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description,
            offer_price = excluded.offer_price, availability_id = excluded.availability_id, responded_at = now()
        where business_request_offers.status = 'pending';

      if found then
        if not v_already_offered then
          v_new_count := v_new_count + 1;
        end if;

        perform public._emit_event('BUSINESS_OFFER_SENT', 'business_request_offer', (select id from business_request_offers where request_id = request_id_param and partner_id = v_preferred.partner_id),
          (select requester_id from business_requests where id = request_id_param), 'match_availability',
          jsonb_build_object('request_id', request_id_param, 'partner_id', v_preferred.partner_id, 'availability_id', v_preferred.id),
          'BUSINESS_OFFER_SENT:' || (select id from business_request_offers where request_id = request_id_param and partner_id = v_preferred.partner_id));
      end if;
    end if;
  end if;

  for v_avail in
    with reputation as (
      select
        partner_id,
        count(*) as total_opportunities,
        round(100.0 * count(*) filter (where status = 'completed') / nullif(count(*) filter (where status in ('accepted', 'completed')), 0), 1) as completion_rate
      from business_request_offers
      group by partner_id
    )
    select ba.*, p.latitude as partner_lat, p.longitude as partner_lng
    from business_availability ba
    join brand_partners p on p.id = ba.partner_id and p.active = true and not public._business_declines_request(p.id, request_id_param) and not public._business_below_min_spend(p.id, request_id_param)
    left join reputation r on r.partner_id = ba.partner_id
    where ba.status = 'active'
    and ba.ends_at > now()
    and (ba.remaining_capacity is null or party_size_param is null or ba.remaining_capacity >= party_size_param)
    and (preferred_availability_id_param is null or ba.id != preferred_availability_id_param)
    and (category_param is null or ba.category is null or ba.category = category_param)
    and p.latitude is not null and p.longitude is not null
    and (
      date_param is null
      or date_param between ba.starts_at::date and ba.ends_at::date
    )
    and (
      date_param is null or time_window_start_param is null or time_window_end_param is null
      or (date_param + time_window_start_param, date_param + time_window_end_param)
         overlaps (ba.starts_at, ba.ends_at)
    )
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= least(radius_miles_param, ba.radius_miles)
    order by
      (r.total_opportunities is not null and r.total_opportunities >= 5) desc,
      r.completion_rate desc nulls last,
      ba.created_at desc
    limit 5
  loop
    select exists(
      select 1 from business_request_offers
      where request_id = request_id_param and partner_id = v_avail.partner_id
    ) into v_already_offered;

    insert into business_request_offers (request_id, partner_id, offer_type, offer_description, offer_price, availability_id, status, responded_at)
    values (request_id_param, v_avail.partner_id, v_avail.offer_type, coalesce(v_avail.description, v_avail.title), v_avail.price, v_avail.id, 'offered', now())
    on conflict (request_id, partner_id) do update
      set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description,
          offer_price = excluded.offer_price, availability_id = excluded.availability_id, responded_at = now()
      where business_request_offers.status = 'pending';

    if found then
      if not v_already_offered then
        v_new_count := v_new_count + 1;
      end if;

      perform public._emit_event('BUSINESS_OFFER_SENT', 'business_request_offer', (select id from business_request_offers where request_id = request_id_param and partner_id = v_avail.partner_id),
        (select requester_id from business_requests where id = request_id_param), 'match_availability',
        jsonb_build_object('request_id', request_id_param, 'partner_id', v_avail.partner_id, 'availability_id', v_avail.id),
        'BUSINESS_OFFER_SENT:' || (select id from business_request_offers where request_id = request_id_param and partner_id = v_avail.partner_id));
    end if;
  end loop;

  -- Missed-match instrumentation (Phase 4). Priority order, now with the
  -- real party-size feasibility case inserted between the two existing
  -- capacity-adjacent reasons: an explicit category mismatch is still the
  -- most legible reason; then zero remaining capacity; then a real but
  -- insufficient remaining capacity for the requester's own party size;
  -- then, by elimination, a date/time overlap failure.
  insert into business_match_exclusions (request_id, partner_id, source, reason, availability_id)
  select
    request_id_param,
    ba.partner_id,
    'availability',
    case
      when category_param is not null and ba.category is not null and ba.category <> category_param then 'category_mismatch'
      when not (ba.remaining_capacity is null or ba.remaining_capacity > 0) then 'zero_capacity'
      when party_size_param is not null and ba.remaining_capacity is not null and ba.remaining_capacity < party_size_param then 'insufficient_capacity'
      else 'date_or_time_mismatch'
    end,
    ba.id
  from business_availability ba
  join brand_partners p on p.id = ba.partner_id and p.active = true and not public._business_declines_request(p.id, request_id_param) and not public._business_below_min_spend(p.id, request_id_param)
  where ba.status = 'active'
  and ba.ends_at > now()
  and (preferred_availability_id_param is null or ba.id != preferred_availability_id_param)
  and p.latitude is not null and p.longitude is not null
  and (3958.8 * acos(
    least(1.0, greatest(-1.0,
      cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
      sin(radians(latitude_param)) * sin(radians(p.latitude))
    ))
  )) <= least(radius_miles_param, ba.radius_miles)
  and not (
    (ba.remaining_capacity is null or ba.remaining_capacity > 0)
    and (party_size_param is null or ba.remaining_capacity is null or ba.remaining_capacity >= party_size_param)
    and (category_param is null or ba.category is null or ba.category = category_param)
    and (date_param is null or date_param between ba.starts_at::date and ba.ends_at::date)
    and (
      date_param is null or time_window_start_param is null or time_window_end_param is null
      or (date_param + time_window_start_param, date_param + time_window_end_param)
         overlaps (ba.starts_at, ba.ends_at)
    )
  )
  on conflict (request_id, partner_id, availability_id) where source = 'availability' do nothing;

  return v_new_count;
end;
$function$;

-- _match_request_to_package_core
CREATE OR REPLACE FUNCTION public._match_request_to_package_core(request_id_param uuid, latitude_param double precision, longitude_param double precision, radius_miles_param double precision, occasion_param text, party_size_param integer, date_param date, preferred_package_id_param uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_new_count integer := 0;
  v_raw_text text;
  service_key text;
  v_pkg record;
  v_preferred record;
  v_already_offered boolean;
  v_managing_profiles uuid[];
  v_offer_price numeric;
  v_price_is_per_person boolean;
  i integer;
begin
  if occasion_param is null then
    return 0;
  end if;

  select raw_text into v_raw_text from business_requests where id = request_id_param;

  if preferred_package_id_param is not null then
    select bop.*, p.latitude as partner_lat, p.longitude as partner_lng
    into v_preferred
    from business_occasion_packages bop
    join brand_partners p on p.id = bop.partner_id and p.active = true and not public._business_declines_request(p.id, request_id_param) and not public._business_below_min_spend(p.id, request_id_param) and not public._business_closed_for_request(p.id, request_id_param)
    where bop.id = preferred_package_id_param
    and bop.active = true
    and bop.occasion_type = occasion_param
    and (bop.min_guests is null or party_size_param is null or party_size_param >= bop.min_guests)
    and p.latitude is not null and p.longitude is not null
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= radius_miles_param;

    if found then
      v_offer_price := case
        when v_preferred.price_per_person is not null and party_size_param is not null
          then v_preferred.price_per_person * party_size_param
        else v_preferred.price_per_person
      end;
      -- Genuinely per-person only when a real rate exists AND it could NOT
      -- be multiplied into a total (party size unknown) -- the exact other
      -- half of the case expression directly above, never re-derived
      -- separately so the two can't drift apart.
      v_price_is_per_person := (v_preferred.price_per_person is not null and party_size_param is null);

      select exists(
        select 1 from business_request_offers
        where request_id = request_id_param and partner_id = v_preferred.partner_id
      ) into v_already_offered;

      insert into business_request_offers (
        request_id, partner_id, offer_type, offer_description, offer_title, included_items,
        offer_price, price_is_per_person, package_id, status, responded_at
      )
      values (
        request_id_param, v_preferred.partner_id, 'standard',
        v_preferred.name || coalesce(': ' || v_preferred.description, ''),
        v_preferred.name, v_preferred.included_items,
        v_offer_price, v_price_is_per_person, v_preferred.id, 'offered', now()
      )
      on conflict (request_id, partner_id) do update
        set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description,
            offer_title = excluded.offer_title, included_items = excluded.included_items,
            offer_price = excluded.offer_price, price_is_per_person = excluded.price_is_per_person,
            package_id = excluded.package_id, responded_at = now()
        where business_request_offers.status = 'pending';

      if found then
        if not v_already_offered then
          v_new_count := v_new_count + 1;
        end if;

        perform public._emit_event('BUSINESS_OFFER_SENT', 'business_request_offer', (select id from business_request_offers where request_id = request_id_param and partner_id = v_preferred.partner_id),
          (select requester_id from business_requests where id = request_id_param), 'match_package',
          jsonb_build_object('request_id', request_id_param, 'partner_id', v_preferred.partner_id, 'package_id', v_preferred.id),
          'BUSINESS_OFFER_SENT:' || (select id from business_request_offers where request_id = request_id_param and partner_id = v_preferred.partner_id));
      end if;
    end if;
  end if;

  for v_pkg in
    select bop.*, p.latitude as partner_lat, p.longitude as partner_lng
    from business_occasion_packages bop
    join brand_partners p on p.id = bop.partner_id and p.active = true and not public._business_declines_request(p.id, request_id_param) and not public._business_below_min_spend(p.id, request_id_param) and not public._business_closed_for_request(p.id, request_id_param)
    where bop.active = true
    and bop.occasion_type = occasion_param
    and (preferred_package_id_param is null or bop.id != preferred_package_id_param)
    and (bop.min_guests is null or party_size_param is null or party_size_param >= bop.min_guests)
    and (
      date_param is null or bop.available_days is null
      or extract(dow from date_param)::smallint = any(bop.available_days)
    )
    and p.latitude is not null and p.longitude is not null
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= radius_miles_param
    order by bop.created_at desc
    limit 5
  loop
    select exists(
      select 1 from business_request_offers
      where request_id = request_id_param and partner_id = v_pkg.partner_id
    ) into v_already_offered;

    v_offer_price := case
      when v_pkg.price_per_person is not null and party_size_param is not null
        then v_pkg.price_per_person * party_size_param
      else v_pkg.price_per_person
    end;
    v_price_is_per_person := (v_pkg.price_per_person is not null and party_size_param is null);

    insert into business_request_offers (
      request_id, partner_id, offer_type, offer_description, offer_title, included_items,
      offer_price, price_is_per_person, package_id, status, responded_at
    )
    values (
      request_id_param, v_pkg.partner_id, 'standard',
      v_pkg.name || coalesce(': ' || v_pkg.description, ''),
      v_pkg.name, v_pkg.included_items,
      v_offer_price, v_price_is_per_person, v_pkg.id, 'offered', now()
    )
    on conflict (request_id, partner_id) do update
      set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description,
          offer_title = excluded.offer_title, included_items = excluded.included_items,
          offer_price = excluded.offer_price, price_is_per_person = excluded.price_is_per_person,
          package_id = excluded.package_id, responded_at = now()
      where business_request_offers.status = 'pending';

    if found then
      if not v_already_offered then
        v_new_count := v_new_count + 1;
      end if;

      perform public._emit_event('BUSINESS_OFFER_SENT', 'business_request_offer', (select id from business_request_offers where request_id = request_id_param and partner_id = v_pkg.partner_id),
        (select requester_id from business_requests where id = request_id_param), 'match_package',
        jsonb_build_object('request_id', request_id_param, 'partner_id', v_pkg.partner_id, 'package_id', v_pkg.id),
        'BUSINESS_OFFER_SENT:' || (select id from business_request_offers where request_id = request_id_param and partner_id = v_pkg.partner_id));
    end if;
  end loop;

  return v_new_count;
end;
$function$;

-- _match_request_to_policy_core
CREATE OR REPLACE FUNCTION public._match_request_to_policy_core(request_id_param uuid, latitude_param double precision, longitude_param double precision, radius_miles_param double precision, party_size_param integer, time_window_start_param time without time zone, time_window_end_param time without time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_new_count integer := 0;
  v_raw_text text;
  v_request_date date;
  service_key text;
  v_policy record;
  v_already_offered boolean;
  v_managing_profiles uuid[];
  i integer;
begin
  select raw_text, date into v_raw_text, v_request_date from business_requests where id = request_id_param;

  for v_policy in
    with reputation as (
      select
        partner_id,
        count(*) as total_opportunities,
        round(100.0 * count(*) filter (where status = 'completed') / nullif(count(*) filter (where status in ('accepted', 'completed')), 0), 1) as completion_rate
      from business_request_offers
      group by partner_id
    )
    select bfp.*, p.latitude as partner_lat, p.longitude as partner_lng, p.name as partner_name
    from business_fulfillment_policies bfp
    join brand_partners p on p.id = bfp.partner_id and p.active = true and not public._business_declines_request(p.id, request_id_param) and not public._business_below_min_spend(p.id, request_id_param)
      and not public._business_closed_for_request(p.id, request_id_param)
    left join reputation r on r.partner_id = bfp.partner_id
    where bfp.active = true
    and bfp.auto_accept_party_size_max is not null
    and p.latitude is not null and p.longitude is not null
    and (party_size_param is null or party_size_param <= bfp.auto_accept_party_size_max)
    and (bfp.party_size_min is null or party_size_param is null or party_size_param >= bfp.party_size_min)
    and (bfp.party_size_max is null or party_size_param is null or party_size_param <= bfp.party_size_max)
    and (
      bfp.active_hours_start is null or bfp.active_hours_end is null
      or time_window_start_param is null or time_window_end_param is null
      or (time_window_start_param, time_window_end_param) overlaps (bfp.active_hours_start, bfp.active_hours_end)
    )
    and (
      bfp.active_days is null or v_request_date is null
      or extract(dow from v_request_date)::smallint = any(bfp.active_days)
    )
    and (
      not bfp.weather_dependent
      or bfp.last_rain_risk is distinct from 'high'
      or bfp.last_weather_checked_at is null
      or bfp.last_weather_checked_at <= now() - interval '3 hours'
    )
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= radius_miles_param
    order by
      (r.total_opportunities is not null and r.total_opportunities >= 5) desc,
      r.completion_rate desc nulls last,
      bfp.created_at desc
    limit 5
  loop
    select exists(
      select 1 from business_request_offers
      where request_id = request_id_param and partner_id = v_policy.partner_id
    ) into v_already_offered;

    insert into business_request_offers (request_id, partner_id, offer_type, offer_description, status, responded_at)
    values (
      request_id_param, v_policy.partner_id, 'standard',
      'Automatically accepted -- within ' || coalesce(v_policy.partner_name, 'this business') || '''s standing party-size policy.',
      'offered', now()
    )
    on conflict (request_id, partner_id) do update
      set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description, responded_at = now()
      where business_request_offers.status = 'pending';

    if found then
      if not v_already_offered then
        v_new_count := v_new_count + 1;
      end if;

      perform public._emit_event('BUSINESS_OFFER_SENT', 'business_request_offer', (select id from business_request_offers where request_id = request_id_param and partner_id = v_policy.partner_id),
        (select requester_id from business_requests where id = request_id_param), 'match_policy',
        jsonb_build_object('request_id', request_id_param, 'partner_id', v_policy.partner_id),
        'BUSINESS_OFFER_SENT:' || (select id from business_request_offers where request_id = request_id_param and partner_id = v_policy.partner_id));
    end if;
  end loop;

  -- Missed-match instrumentation: priority order stays the same reasoning
  -- as before -- can't auto-accept at all, then party size, then hours,
  -- then active days (the new predicate, inserted before weather so
  -- weather stays the real catch-all it already was), and by elimination
  -- weather is the only real predicate left once the first four all pass.
  insert into business_match_exclusions (request_id, partner_id, source, reason, availability_id)
  select
    request_id_param,
    bfp.partner_id,
    'policy',
    case
      when bfp.auto_accept_party_size_max is null then 'no_auto_accept'
      when not (
        (party_size_param is null or party_size_param <= bfp.auto_accept_party_size_max)
        and (bfp.party_size_min is null or party_size_param is null or party_size_param >= bfp.party_size_min)
        and (bfp.party_size_max is null or party_size_param is null or party_size_param <= bfp.party_size_max)
      ) then 'party_size_out_of_range'
      when public._business_closed_for_request(bfp.partner_id, request_id_param) then 'hours_mismatch'  -- item 116: known closed then
      when not (
        bfp.active_hours_start is null or bfp.active_hours_end is null
        or time_window_start_param is null or time_window_end_param is null
        or (time_window_start_param, time_window_end_param) overlaps (bfp.active_hours_start, bfp.active_hours_end)
      ) then 'hours_mismatch'
      when not (
        bfp.active_days is null or v_request_date is null
        or extract(dow from v_request_date)::smallint = any(bfp.active_days)
      ) then 'active_days_mismatch'
      else 'weather_unfavorable'
    end,
    null
  from business_fulfillment_policies bfp
  join brand_partners p on p.id = bfp.partner_id and p.active = true and not public._business_declines_request(p.id, request_id_param) and not public._business_below_min_spend(p.id, request_id_param)
  where bfp.active = true
  and p.latitude is not null and p.longitude is not null
  and (3958.8 * acos(
    least(1.0, greatest(-1.0,
      cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
      sin(radians(latitude_param)) * sin(radians(p.latitude))
    ))
  )) <= radius_miles_param
  and not (
    bfp.auto_accept_party_size_max is not null
    and (party_size_param is null or party_size_param <= bfp.auto_accept_party_size_max)
    and (bfp.party_size_min is null or party_size_param is null or party_size_param >= bfp.party_size_min)
    and (bfp.party_size_max is null or party_size_param is null or party_size_param <= bfp.party_size_max)
    and (
      bfp.active_hours_start is null or bfp.active_hours_end is null
      or time_window_start_param is null or time_window_end_param is null
      or (time_window_start_param, time_window_end_param) overlaps (bfp.active_hours_start, bfp.active_hours_end)
    )
    and (
      bfp.active_days is null or v_request_date is null
      or extract(dow from v_request_date)::smallint = any(bfp.active_days)
    )
    and (
      not bfp.weather_dependent
      or bfp.last_rain_risk is distinct from 'high'
      or bfp.last_weather_checked_at is null
      or bfp.last_weather_checked_at <= now() - interval '3 hours'
    )
    and not public._business_closed_for_request(bfp.partner_id, request_id_param)
  )
  on conflict (request_id, partner_id) where source = 'policy' do nothing;

  return v_new_count;
end;
$function$;

-- _ai_auto_respond_to_business_requests
CREATE OR REPLACE FUNCTION public._ai_auto_respond_to_business_requests(request_id_param uuid, latitude_param double precision, longitude_param double precision, radius_miles_param double precision, category_param text, party_size_param integer, time_window_start_param time without time zone, time_window_end_param time without time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_new_count integer := 0;
  v_raw_text text;
  service_key text;
  v_policy record;
  v_already_offered boolean;
  v_managing_profiles uuid[];
  i integer;
  v_exp record;
  v_reason text;
  v_offer_price numeric;
begin
  select raw_text into v_raw_text from business_requests where id = request_id_param;

  for v_policy in
    with reputation as (
      select
        partner_id,
        count(*) as total_opportunities,
        round(100.0 * count(*) filter (where status = 'completed') / nullif(count(*) filter (where status in ('accepted', 'completed')), 0), 1) as completion_rate
      from business_request_offers
      group by partner_id
    )
    select bap.*, p.latitude as partner_lat, p.longitude as partner_lng, p.name as partner_name, p.ai_trust_level
    from business_ai_policies bap
    join brand_partners p on p.id = bap.partner_id and p.active = true
    left join reputation r on r.partner_id = bap.partner_id
    where bap.enabled = true
    and bap.action_type = 'auto_respond_offer'
    and p.ai_trust_level >= 2
    and bap.trust_level <= p.ai_trust_level
    and p.latitude is not null and p.longitude is not null
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= radius_miles_param
    order by
      (r.total_opportunities is not null and r.total_opportunities >= 5) desc,
      r.completion_rate desc nulls last,
      bap.created_at desc
  loop
    v_reason := null;
    v_exp := null;

    if category_param is null or (v_policy.conditions ->> 'category') is distinct from category_param then
      v_reason := 'category_mismatch';
    elsif party_size_param is not null and v_policy.conditions ? 'party_size_max'
          and party_size_param > (v_policy.conditions ->> 'party_size_max')::integer then
      v_reason := 'party_size_out_of_range';
    elsif v_policy.conditions ? 'hours_start' and v_policy.conditions ? 'hours_end'
          and time_window_start_param is not null and time_window_end_param is not null
          and not ((time_window_start_param, time_window_end_param) overlaps
                    ((v_policy.conditions ->> 'hours_start')::time, (v_policy.conditions ->> 'hours_end')::time)) then
      v_reason := 'hours_mismatch';
    else
      select * into v_exp from business_experiences
      where id = (v_policy.conditions ->> 'experience_id')::uuid
      and partner_id = v_policy.partner_id and active = true;

      if v_exp.id is null then
        v_reason := 'experience_inactive';
      end if;
    end if;

    if v_reason is not null then
      insert into ai_actions (
        partner_id, action_type, trust_level, risk_level, policy_id, input_ref,
        proposed_action, requires_approval, approval_result, outcome
      ) values (
        v_policy.partner_id, 'auto_respond_offer', v_policy.ai_trust_level, 'medium', v_policy.id,
        jsonb_build_object('request_id', request_id_param, 'category', category_param, 'party_size', party_size_param),
        jsonb_build_object('policy_name', v_policy.name),
        false, 'blocked', v_reason
      )
      on conflict (policy_id, (input_ref ->> 'request_id')) where approval_result = 'blocked' do nothing;
      continue;
    end if;

    select exists(
      select 1 from business_request_offers
      where request_id = request_id_param and partner_id = v_policy.partner_id
    ) into v_already_offered;

    v_offer_price := case v_exp.price_level
      when '$' then 15 when '$$' then 35 when '$$$' then 65 else null
    end;

    insert into business_request_offers (
      request_id, partner_id, offer_type, offer_price, offer_description, status, responded_at
    ) values (
      request_id_param, v_policy.partner_id, 'standard', v_offer_price,
      coalesce(v_policy.partner_name, 'This business') || ' automatically confirmed: ' || v_exp.title
        || case when v_exp.description is not null then ' -- ' || v_exp.description else '' end,
      'offered', now()
    )
    on conflict (request_id, partner_id) do update
      set status = 'offered', offer_type = excluded.offer_type,
          offer_price = excluded.offer_price, offer_description = excluded.offer_description,
          responded_at = now()
      where business_request_offers.status = 'pending';

    if found then
      if not v_already_offered then
        v_new_count := v_new_count + 1;
      end if;

      insert into ai_actions (
        partner_id, action_type, trust_level, risk_level, policy_id, input_ref,
        proposed_action, actual_action, confidence, requires_approval, approval_result
      ) values (
        v_policy.partner_id, 'auto_respond_offer', v_policy.ai_trust_level, 'medium', v_policy.id,
        jsonb_build_object('request_id', request_id_param, 'category', category_param, 'party_size', party_size_param),
        jsonb_build_object('experience_id', v_exp.id, 'experience_title', v_exp.title, 'price_level', v_exp.price_level),
        jsonb_build_object('offer_type', 'standard', 'offer_price', v_offer_price),
        null, false, 'auto_applied'
      );

      perform public._emit_event('BUSINESS_OFFER_SENT', 'business_request_offer', (select id from business_request_offers where request_id = request_id_param and partner_id = v_policy.partner_id),
        (select requester_id from business_requests where id = request_id_param), 'ai_auto_respond',
        jsonb_build_object('request_id', request_id_param, 'partner_id', v_policy.partner_id, 'policy_id', v_policy.id),
        'BUSINESS_OFFER_SENT:' || (select id from business_request_offers where request_id = request_id_param and partner_id = v_policy.partner_id));
    end if;
  end loop;

  return v_new_count;
end;
$function$;

-- submit_business_offer
CREATE OR REPLACE FUNCTION public.submit_business_offer(request_id_param uuid, offer_type_param text, offer_description_param text, offer_price_param numeric DEFAULT NULL::numeric, proposed_time_param timestamp with time zone DEFAULT NULL::timestamp with time zone, experience_id_param uuid DEFAULT NULL::uuid, media_path_param text DEFAULT NULL::text, media_type_param text DEFAULT NULL::text, offer_title_param text DEFAULT NULL::text, included_items_param text[] DEFAULT '{}'::text[], price_is_per_person_param boolean DEFAULT false, discount_pct_param numeric DEFAULT NULL::numeric, redemption_instructions_param text DEFAULT NULL::text, media_poster_path_param text DEFAULT NULL::text, creative_id_param uuid DEFAULT NULL::uuid, valid_until_param timestamp with time zone DEFAULT NULL::timestamp with time zone, available_from_param time without time zone DEFAULT NULL::time without time zone, available_until_param time without time zone DEFAULT NULL::time without time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_partner_id uuid;
  v_row record;
  v_request_status text;
  v_request_expires_at timestamptz;
  v_requester_id uuid;
  v_raw_text text;
  v_partner_name text;
  v_occ_type text;
  v_occ_who text;
  v_push_title text;
  v_push_body text;
  v_req_category text;
  v_req_gathering uuid;
  v_offer_title text;
  v_creative record;
  v_items text[];
  service_key text;
begin
  select managed_partner_id into v_partner_id from profiles where id = auth.uid();
  if v_partner_id is null then
    raise exception 'You do not manage a business.';
  end if;

  if media_type_param is not null and media_type_param not in ('image', 'video') then
    raise exception 'Invalid media type';
  end if;

  select status, requester_id, raw_text, expires_at into v_request_status, v_requester_id, v_raw_text, v_request_expires_at
  from business_requests where id = request_id_param;
  if v_request_status is null then
    raise exception 'Request not found.';
  end if;
  if v_request_status <> 'open' then
    raise exception 'This request is no longer open.';
  end if;
  -- The hourly sweep flips status; the deadline itself is authoritative the moment it passes.
  if v_request_expires_at is not null and v_request_expires_at <= now() then
    raise exception 'This request has expired.';
  end if;

  select * into v_row from business_request_offers
  where request_id = request_id_param and partner_id = v_partner_id
  for update;

  if v_row is null then
    raise exception 'This request was not sent to your business.';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'You have already responded to this request.';
  end if;

  if discount_pct_param is not null and (discount_pct_param < 0 or discount_pct_param > 100) then
    raise exception 'Discount percent must be between 0 and 100.';
  end if;

  -- A saved creative REPLACES any media passed: its file and poster come from the library row (already screened).
  if creative_id_param is not null then
    select * into v_creative from business_creatives
     where id = creative_id_param and partner_id = v_partner_id and archived_at is null;
    if not found then raise exception 'That saved creative is not available.'; end if;
    media_path_param := v_creative.media_path;
    media_type_param := v_creative.media_type;
    media_poster_path_param := v_creative.poster_path;
  end if;
  if valid_until_param is not null and (valid_until_param <= now() or valid_until_param > now() + interval '30 days') then
    raise exception 'Pick an end time that is later than now (within 30 days).';
  end if;
  -- "Available 6:00-8:00 PM": the owner's own time-of-day window for when this offer can be used, on the day the visit
  -- is for (the accepted alternative time's day, else the request's date). Both ends or neither; same-day only.
  if (available_from_param is null) <> (available_until_param is null) then
    raise exception 'Set both a start and an end for the available window, or neither.';
  end if;
  if available_from_param is not null and available_until_param <= available_from_param then
    raise exception 'The available window must end after it starts.';
  end if;
  if redemption_instructions_param is not null and length(redemption_instructions_param) > 500 then
    raise exception 'Redemption instructions are too long.';
  end if;
  -- A video offer must carry a preview image (the frame Nearby screened); an image offer needs none.
  if media_type_param = 'video' and media_poster_path_param is null then
    raise exception 'A video needs a preview image.';
  end if;
  -- Media must live in this business's own folder of the offer-media bucket.
  if media_path_param is not null and media_path_param not like v_partner_id::text || '/%' then
    raise exception 'Invalid media.';
  end if;
  if media_poster_path_param is not null and media_poster_path_param not like v_partner_id::text || '/%' then
    raise exception 'Invalid media.';
  end if;

  v_offer_title := nullif(trim(coalesce(offer_title_param, '')), '');

  select array_agg(trim(item)) into v_items
  from unnest(coalesce(included_items_param, '{}'::text[])) as item
  where length(trim(item)) > 0;

  update business_request_offers
  set status = 'offered',
      offer_type = offer_type_param,
      offer_description = offer_description_param,
      offer_title = v_offer_title,
      included_items = coalesce(v_items, '{}'),
      offer_price = offer_price_param,
      price_is_per_person = coalesce(price_is_per_person_param, false),
      discount_pct = discount_pct_param,
      proposed_time = proposed_time_param,
      experience_id = experience_id_param,
      media_path = media_path_param,
      media_type = media_type_param,
      media_poster_path = case when media_type_param = 'video' then media_poster_path_param else null end,
      redemption_instructions = nullif(trim(coalesce(redemption_instructions_param, '')), ''),
      creative_id = creative_id_param,
      valid_until = valid_until_param,
      available_from = available_from_param,
      available_until = available_until_param,
      responded_at = now()
  where id = v_row.id;

  -- Item 125: the reply is an event; the notification layer tells the customer (wording from _business_reply_push).
  perform public._emit_event('BUSINESS_OFFER_SENT', 'business_request_offer', v_row.id, auth.uid(), 'submit_business_offer',
    jsonb_build_object('request_id', request_id_param, 'partner_id', v_partner_id, 'offer_id', v_row.id),
    'BUSINESS_OFFER_SENT:' || v_row.id);

  return jsonb_build_object('success', true, 'offerId', v_row.id);
end;
$function$;

-- admin_review_business_content_screening
CREATE OR REPLACE FUNCTION public.admin_review_business_content_screening(screening_id_param uuid, approve_param boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row business_content_screening_results;
  v_entitlement jsonb;
  v_current_count integer;
  v_lat double precision;
  v_lng double precision;
  v_gathering_scheduled_at timestamptz;
  v_expires_at timestamptz;
  v_duration_hours numeric;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_request_status text;
  v_requester_id uuid;
  v_raw_text text;
  v_partner_name text;
  v_occ_type text;
  v_occ_who text;
  v_push_title text;
  v_push_body text;
  v_offer_title text;
  v_items text[];
  service_key text;
begin
  if not check_is_admin(auth.uid()) then
    raise exception 'Only admins can review business content';
  end if;

  select * into v_row from business_content_screening_results where id = screening_id_param for update;
  if v_row.id is null then
    raise exception 'Screening result not found';
  end if;
  if v_row.review_outcome is not null then
    raise exception 'This has already been reviewed';
  end if;

  if v_row.source = 'resweep' then
    update business_content_screening_results
    set review_outcome = case when approve_param then 'approved' else 'denied' end,
        reviewed_by = auth.uid(),
        reviewed_at = now()
    where id = screening_id_param;
    return;
  end if;

  if approve_param and v_row.target_type = 'business_profile' then
    update brand_partners set
      name = coalesce(v_row.content_snapshot->>'name', name),
      description = v_row.content_snapshot->>'description',
      logo_url = v_row.content_snapshot->>'logoUrl',
      category = v_row.content_snapshot->>'category',
      attributes = coalesce(
        (select array_agg(value) from jsonb_array_elements_text(v_row.content_snapshot->'attributes')),
        '{}'::text[]
      ),
      cuisine = v_row.content_snapshot->>'cuisine',
      differentiator = v_row.content_snapshot->>'differentiator',
      subcategory = v_row.content_snapshot->>'subcategory'
    where id = v_row.partner_id;
  end if;

  if approve_param and v_row.target_type = 'experience' then
    if v_row.content_snapshot->>'experienceId' is null then
      select check_business_entitlement(v_row.partner_id, 'signature_experiences') into v_entitlement;
      if (v_entitlement ->> 'limit_value') is not null then
        select count(*) into v_current_count from business_experiences where partner_id = v_row.partner_id;
        if v_current_count >= (v_entitlement ->> 'limit_value')::integer then
          raise exception 'ENTITLEMENT_LIMIT:signature_experiences';
        end if;
      end if;

      insert into business_experiences (
        partner_id, title, description, icon, attributes, price_level, party_type, ai_suggested, media_path, media_type
      ) values (
        v_row.partner_id,
        v_row.content_snapshot->>'title',
        v_row.content_snapshot->>'description',
        v_row.content_snapshot->>'icon',
        coalesce(
          (select array_agg(value) from jsonb_array_elements_text(v_row.content_snapshot->'attributes')),
          '{}'::text[]
        ),
        v_row.content_snapshot->>'priceLevel',
        v_row.content_snapshot->>'partyType',
        false,
        v_row.content_snapshot->>'mediaPath',
        v_row.content_snapshot->>'mediaType'
      );
    else
      update business_experiences set
        title = coalesce(v_row.content_snapshot->>'title', title),
        description = v_row.content_snapshot->>'description',
        icon = v_row.content_snapshot->>'icon',
        attributes = coalesce(
          (select array_agg(value) from jsonb_array_elements_text(v_row.content_snapshot->'attributes')),
          '{}'::text[]
        ),
        price_level = v_row.content_snapshot->>'priceLevel',
        party_type = v_row.content_snapshot->>'partyType',
        media_path = v_row.content_snapshot->>'mediaPath',
        media_type = v_row.content_snapshot->>'mediaType',
        ai_suggested = false,
        updated_at = now()
      where id = (v_row.content_snapshot->>'experienceId')::uuid and partner_id = v_row.partner_id;
    end if;
  end if;

  if approve_param and v_row.target_type = 'offer' then
    v_expires_at := null;
    if (v_row.content_snapshot->>'gatheringId') is not null then
      select scheduled_at into v_gathering_scheduled_at from gatherings where id = (v_row.content_snapshot->>'gatheringId')::uuid;
      if v_gathering_scheduled_at is not null then
        v_expires_at := v_gathering_scheduled_at + interval '48 hours';
      end if;
    end if;

    insert into brand_offers (
      partner_id, title, description, reward_type, redemption_instructions, active,
      gathering_id, expires_at, redemption_limit, target_interest_tag,
      unlock_scope, unlock_community_id, unlock_min_members
    ) values (
      v_row.partner_id,
      v_row.content_snapshot->>'title',
      v_row.content_snapshot->>'description',
      coalesce(v_row.content_snapshot->>'rewardType', 'discount'),
      v_row.content_snapshot->>'redemptionInstructions',
      true,
      nullif(v_row.content_snapshot->>'gatheringId', '')::uuid,
      v_expires_at,
      nullif(v_row.content_snapshot->>'redemptionLimit', '')::integer,
      nullif(v_row.content_snapshot->>'targetInterestTag', ''),
      nullif(v_row.content_snapshot->>'unlockScope', ''),
      nullif(v_row.content_snapshot->>'unlockCommunityId', '')::uuid,
      nullif(v_row.content_snapshot->>'unlockMinMembers', '')::integer
    );
  end if;

  if approve_param and v_row.target_type = 'availability' then
    select latitude, longitude into v_lat, v_lng from brand_partners where id = v_row.partner_id;
    if v_lat is null or v_lng is null then
      raise exception 'This business no longer has an address set -- the availability posting could not be published.';
    end if;

    v_duration_hours := nullif(v_row.content_snapshot->>'durationHours', '')::numeric;
    v_starts_at := coalesce(nullif(v_row.content_snapshot->>'startsAt', '')::timestamptz, now());
    v_ends_at := case
      when nullif(v_row.content_snapshot->>'endsAt', '') is not null then (v_row.content_snapshot->>'endsAt')::timestamptz
      when v_duration_hours is not null then v_starts_at + (v_duration_hours || ' hours')::interval
      else date_trunc('day', v_starts_at) + interval '1 day' - interval '1 second'
    end;
    if v_ends_at <= now() then
      raise exception 'This availability window has already passed -- it could not be published.';
    end if;

    insert into business_availability (
      partner_id, category, title, description, offer_type, price,
      capacity, remaining_capacity, starts_at, ends_at, radius_miles,
      bundle_occasion, bundle_components, discount_pct
    ) values (
      v_row.partner_id,
      v_row.content_snapshot->>'category',
      v_row.content_snapshot->>'title',
      v_row.content_snapshot->>'description',
      v_row.content_snapshot->>'offerType',
      nullif(v_row.content_snapshot->>'price', '')::numeric,
      nullif(v_row.content_snapshot->>'capacity', '')::integer,
      nullif(v_row.content_snapshot->>'capacity', '')::integer,
      v_starts_at,
      v_ends_at,
      coalesce(nullif(v_row.content_snapshot->>'radiusMiles', '')::double precision, 15),
      nullif(v_row.content_snapshot->>'bundleOccasion', ''),
      coalesce(
        (select array_agg(value) from jsonb_array_elements_text(v_row.content_snapshot->'bundleComponents')),
        '{}'::text[]
      ),
      nullif(v_row.content_snapshot->>'discountPct', '')::numeric
    );
  end if;

  if approve_param and v_row.target_type = 'update' then
    insert into business_updates (partner_id, title, body)
    values (v_row.partner_id, v_row.content_snapshot->>'title', v_row.content_snapshot->>'body');
  end if;

  if approve_param and v_row.target_type = 'offer_response' then
    select status, requester_id, raw_text into v_request_status, v_requester_id, v_raw_text
    from business_requests where id = nullif(v_row.content_snapshot->>'requestId', '')::uuid;
    if v_request_status is distinct from 'open' then
      raise exception 'This request is no longer open -- the offer response could not be published.';
    end if;

    if nullif(v_row.content_snapshot->>'validUntil', '')::timestamptz <= now() then
      raise exception 'This offer''s end time has already passed -- it could not be published.';
    end if;
    v_offer_title := nullif(trim(coalesce(v_row.content_snapshot->>'offerTitle', '')), '');

    -- Same trim + blank-filter discipline as submit_business_offer/
    -- create_occasion_package -- never a second, laxer validation rule
    -- for the identical real shape just because it arrived via a
    -- different write path (found live via Test 4 below: an earlier
    -- draft of this branch skipped the filter and let a blank jsonb
    -- array entry survive as a literal empty-string item).
    select array_agg(trim(item)) into v_items
    from jsonb_array_elements_text(coalesce(v_row.content_snapshot->'includedItems', '[]'::jsonb)) as item
    where length(trim(item)) > 0;

    update business_request_offers
    set status = 'offered',
        offer_type = v_row.content_snapshot->>'offerType',
        offer_description = v_row.content_snapshot->>'offerDescription',
        offer_title = v_offer_title,
        included_items = coalesce(v_items, '{}'::text[]),
        offer_price = nullif(v_row.content_snapshot->>'offerPrice', '')::numeric,
        price_is_per_person = coalesce((v_row.content_snapshot->>'priceIsPerPerson')::boolean, false),
        discount_pct = nullif(v_row.content_snapshot->>'discountPct', '')::numeric,
        proposed_time = nullif(v_row.content_snapshot->>'proposedTime', '')::timestamptz,
        experience_id = nullif(v_row.content_snapshot->>'experienceId', '')::uuid,
        media_path = v_row.content_snapshot->>'mediaPath',
        media_type = v_row.content_snapshot->>'mediaType',
        media_poster_path = case when v_row.content_snapshot->>'mediaType' = 'video' then nullif(v_row.content_snapshot->>'posterPath', '') else null end,
        redemption_instructions = nullif(trim(coalesce(v_row.content_snapshot->>'redemptionInstructions', '')), ''),
        creative_id = nullif(v_row.content_snapshot->>'creativeId', '')::uuid,
        valid_until = nullif(v_row.content_snapshot->>'validUntil', '')::timestamptz,
        available_from = nullif(v_row.content_snapshot->>'availableFrom', '')::time,
        available_until = nullif(v_row.content_snapshot->>'availableUntil', '')::time,
        responded_at = now()
    where request_id = nullif(v_row.content_snapshot->>'requestId', '')::uuid
      and partner_id = v_row.partner_id
      and status = 'pending';

    if not found then
      raise exception 'This offer response could not be published -- it may have expired or already been responded to.';
    end if;

    -- Item 125: the same BUSINESS_OFFER_SENT event as a direct reply.
    perform public._emit_event('BUSINESS_OFFER_SENT', 'business_request_offer', o.id, null,
      'admin_review_business_content_screening',
      jsonb_build_object('request_id', o.request_id, 'partner_id', o.partner_id, 'offer_id', o.id),
      'BUSINESS_OFFER_SENT:' || o.id)
    from business_request_offers o
    where o.request_id = nullif(v_row.content_snapshot->>'requestId', '')::uuid and o.partner_id = v_row.partner_id;
  end if;

  update business_content_screening_results
  set review_outcome = case when approve_param then 'approved' else 'denied' end,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = screening_id_param;
end;
$function$;

-- accept_business_offer
CREATE OR REPLACE FUNCTION public.accept_business_offer(offer_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_offer record;
  v_request record;
  v_availability record;
  v_reservation_id uuid;
  v_managing_profiles uuid[];
  service_key text;
  v_stripe_ready boolean;
  v_payment_status text;
  v_payment_provider text;
  v_partner_name text;
  v_occ_type text;
  v_occ_who text;
  v_consumer_title text;
  v_consumer_body text;
begin
  select * into v_offer from business_request_offers where id = offer_id_param;
  if v_offer is null then
    raise exception 'Offer not found.';
  end if;

  select * into v_request from business_requests where id = v_offer.request_id for update;
  if v_request is null then
    raise exception 'Request not found.';
  end if;
  if v_request.requester_id <> auth.uid() then
    raise exception 'You do not own this request.';
  end if;
  if v_request.status <> 'open' then
    raise exception 'This request has already been resolved.';
  end if;
  if v_offer.status <> 'offered' then
    raise exception 'This offer is no longer available.';
  end if;
  if v_offer.valid_until is not null and v_offer.valid_until <= now() then
    raise exception 'This offer has expired.';
  end if;

  if v_offer.availability_id is not null then
    select * into v_availability from business_availability where id = v_offer.availability_id for update;
    if v_availability is not null and v_availability.remaining_capacity is not null then
      if v_availability.remaining_capacity <= 0 then
        raise exception 'This availability just filled up.';
      end if;
      update business_availability
      set remaining_capacity = remaining_capacity - 1,
          status = case when remaining_capacity - 1 <= 0 then 'filled' else status end
      where id = v_offer.availability_id;
    end if;
  end if;

  update business_request_offers
  set status = 'accepted', accepted_at = now()
  where id = offer_id_param;

  update business_request_offers
  set status = 'expired'
  where request_id = v_request.id
  and id <> offer_id_param
  and status in ('pending', 'offered');

  update business_requests
  set status = 'fulfilled'
  where id = v_request.id;

  insert into business_reservations (offer_id, status, provider, confirmed_at)
  values (offer_id_param, 'confirmed', 'nearby', now())
  returning id into v_reservation_id;

  -- Real, honest routing: a payable Stripe PaymentIntent can only follow
  -- when there's a real price AND the business has genuinely finished
  -- Connect onboarding (stripe_charges_enabled) -- otherwise this stays
  -- exactly the pre-Stripe 'not_required' state, never a fabricated
  -- pending charge nothing downstream can actually collect.
  select stripe_charges_enabled into v_stripe_ready
  from brand_partners where id = v_offer.partner_id;

  if v_offer.offer_price is not null and coalesce(v_stripe_ready, false) then
    v_payment_status := 'pending';
    v_payment_provider := 'stripe';
  else
    v_payment_status := 'not_required';
    v_payment_provider := null;
  end if;

  insert into business_payments (reservation_id, status, amount, currency, payer_id, provider)
  values (v_reservation_id, v_payment_status, v_offer.offer_price, 'usd', auth.uid(), v_payment_provider);

  -- Item 125: the accept is an event; the notification layer tells the business, the customer and the rest of the plan.
  perform public._emit_event('BUSINESS_OFFER_ACCEPTED', 'business_request_offer', offer_id_param, auth.uid(), 'accept_business_offer',
    jsonb_build_object('request_id', v_request.id, 'partner_id', v_offer.partner_id, 'offer_id', offer_id_param),
    'BUSINESS_OFFER_ACCEPTED:' || offer_id_param);

  return jsonb_build_object(
    'success', true,
    'reservationId', v_reservation_id,
    'paymentRequired', v_payment_status = 'pending'
  );
end;
$function$;

-- _accept_business_offer_internal
CREATE OR REPLACE FUNCTION public._accept_business_offer_internal(offer_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_offer record;
  v_request record;
  v_availability record;
  v_managing_profiles uuid[];
  service_key text;
begin
  select * into v_offer from business_request_offers where id = offer_id_param for update;
  if v_offer is null then
    raise exception 'Offer not found.';
  end if;

  select * into v_request from business_requests where id = v_offer.request_id for update;
  if v_request is null then
    raise exception 'Request not found.';
  end if;
  if v_request.status <> 'open' then
    raise exception 'This request has already been resolved.';
  end if;
  if v_offer.status <> 'offered' then
    raise exception 'This offer is no longer available.';
  end if;
  if v_offer.valid_until is not null and v_offer.valid_until <= now() then
    raise exception 'This offer has expired.';
  end if;

  if v_offer.availability_id is not null then
    select * into v_availability from business_availability where id = v_offer.availability_id for update;
    if v_availability is not null and v_availability.remaining_capacity is not null then
      if v_availability.remaining_capacity <= 0 then
        raise exception 'This availability just filled up.';
      end if;
      update business_availability
      set remaining_capacity = remaining_capacity - 1,
          status = case when remaining_capacity - 1 <= 0 then 'filled' else status end
      where id = v_offer.availability_id;
    end if;
  end if;

  update business_request_offers set status = 'accepted', accepted_at = now() where id = offer_id_param;

  update business_request_offers
  set status = 'expired'
  where request_id = v_request.id and id <> offer_id_param and status in ('pending', 'offered');

  update business_requests set status = 'fulfilled' where id = v_request.id;

  -- Item 125: the caller (confirm_group_plan_offer) emits BUSINESS_OFFER_ACCEPTED; the business push lives in its handler.
  return jsonb_build_object('success', true);
end;
$function$;

-- confirm_group_plan_offer
CREATE OR REPLACE FUNCTION public.confirm_group_plan_offer(proposal_id_param uuid, offer_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_proposal record;
  v_offer record;
  v_participant record;
  v_required_count integer;
  v_confirmed_count integer;
  v_accept_result jsonb;
  v_notify_row record;
  v_occ_type text;
  v_occ_who text;
  v_final_title text;
  v_final_body text;
  service_key text;
begin
  select * into v_proposal from group_plan_proposals where id = proposal_id_param for update;
  if v_proposal is null then
    raise exception 'Group plan not found.';
  end if;
  if v_proposal.status <> 'confirmed' or v_proposal.resulting_request_id is null then
    raise exception 'This group plan has not been finalized into a real request yet.';
  end if;

  select * into v_offer from business_request_offers where id = offer_id_param for update;
  if v_offer is null or v_offer.request_id <> v_proposal.resulting_request_id then
    raise exception 'This offer does not belong to this group plan.';
  end if;
  if v_offer.status <> 'offered' then
    raise exception 'This offer is no longer available to confirm.';
  end if;
  if v_offer.valid_until is not null and v_offer.valid_until <= now() then
    raise exception 'This offer has expired.';
  end if;

  select * into v_participant from group_plan_participants where proposal_id = proposal_id_param and user_id = auth.uid() and status = 'accepted';
  if v_participant is null then
    raise exception 'You are not an active participant in this group plan.';
  end if;

  insert into group_plan_offer_confirmations (proposal_id, offer_id, user_id)
  values (proposal_id_param, offer_id_param, auth.uid())
  on conflict (offer_id, user_id) do nothing;

  select count(*) into v_required_count from group_plan_participants where proposal_id = proposal_id_param and status = 'accepted';
  select count(*) into v_confirmed_count from group_plan_offer_confirmations where proposal_id = proposal_id_param and offer_id = offer_id_param;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  if v_confirmed_count < v_required_count then
    if service_key is not null then
      for v_notify_row in
        select gpp.user_id from group_plan_participants gpp
        where gpp.proposal_id = proposal_id_param and gpp.status = 'accepted' and gpp.user_id <> auth.uid()
        and not exists (select 1 from group_plan_offer_confirmations c where c.offer_id = offer_id_param and c.user_id = gpp.user_id)
      loop
        continue when not coalesce((select notify_planning from profiles where id = v_notify_row.user_id), true);
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', v_notify_row.user_id,
            'title', 'Confirm your group plan offer',
            'body', 'Someone in your group confirmed a business offer -- confirm your spot too.',
            'data', jsonb_build_object('type', 'group_plan_offer_pending', 'proposal_id', proposal_id_param, 'offer_id', offer_id_param)
          )
        );
      end loop;
    end if;
    return jsonb_build_object('success', true, 'allConfirmed', false, 'confirmedCount', v_confirmed_count, 'requiredCount', v_required_count);
  end if;

  v_accept_result := public._accept_business_offer_internal(offer_id_param);

  -- Item 125: everyone confirmed = the offer is accepted; the notification layer tells the business and the group.
  perform public._emit_event('BUSINESS_OFFER_ACCEPTED', 'business_request_offer', offer_id_param, auth.uid(), 'confirm_group_plan_offer',
    jsonb_build_object('request_id', v_proposal.resulting_request_id, 'offer_id', offer_id_param, 'proposal_id', proposal_id_param),
    'BUSINESS_OFFER_ACCEPTED:' || offer_id_param);

  return jsonb_build_object('success', true, 'allConfirmed', true, 'confirmedCount', v_confirmed_count, 'requiredCount', v_required_count) || v_accept_result;
end;
$function$;

-- complete_business_reservation
CREATE OR REPLACE FUNCTION public.complete_business_reservation(offer_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_offer record;
  v_request record;
  v_reservation record;
  v_partner_id uuid;
begin
  select * into v_offer from business_request_offers where id = offer_id_param for update;
  if v_offer is null then
    raise exception 'Offer not found.';
  end if;
  if v_offer.status <> 'accepted' then
    raise exception 'This reservation is not in a state that can be completed.';
  end if;

  select * into v_reservation from business_reservations where offer_id = offer_id_param for update;
  if v_reservation is null or v_reservation.status <> 'confirmed' then
    raise exception 'This reservation is not in a state that can be completed.';
  end if;
  if exists (select 1 from business_visit_no_shows where offer_id = offer_id_param) then
    raise exception 'This reservation is not in a state that can be completed.';
  end if;

  select * into v_request from business_requests where id = v_offer.request_id;
  select managed_partner_id into v_partner_id from profiles where id = auth.uid();

  if auth.uid() <> v_request.requester_id and (v_partner_id is null or v_partner_id <> v_offer.partner_id) then
    raise exception 'You are not part of this reservation.';
  end if;

  update business_request_offers
  set status = 'completed', completed_at = now()
  where id = offer_id_param;

  -- Completing the primary booking completes the Plan (an add-on's reservation does not complete the whole plan).
  if not exists (select 1 from business_requests where id = v_offer.request_id and parent_request_id is not null) then
    update plans set status = 'completed'
    where resulting_business_request_id = v_offer.request_id and status = 'confirmed';
  end if;

  -- Item 125: recorded only (no redemption push, owner decision).
  perform public._emit_event('OFFER_REDEEMED', 'business_request_offer', offer_id_param, auth.uid(), 'complete_business_reservation',
    jsonb_build_object('request_id', v_offer.request_id, 'partner_id', v_offer.partner_id, 'offer_id', offer_id_param,
                       'reservation_id', v_reservation.id),
    'OFFER_REDEEMED:' || offer_id_param);

  return jsonb_build_object('success', true);
end;
$function$;

-- _notify_other_plan_participants
CREATE OR REPLACE FUNCTION public._notify_other_plan_participants(request_id_param uuid, exclude_user_id uuid, notif_type text, title_text text, body_text text, extra_data jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_primary_id uuid;
  v_plan_id uuid;
  service_key text;
  v_uid uuid;
begin
  select coalesce(parent_request_id, id) into v_primary_id
  from business_requests where id = request_id_param;
  if v_primary_id is null then
    return;
  end if;

  select p.id into v_plan_id from plans p
  where p.resulting_business_request_id = v_primary_id
  order by p.created_at desc limit 1;
  if v_plan_id is null then
    return;
  end if;


  for v_uid in
    select distinct uid from (
      select created_by as uid from plans where id = v_plan_id
      union
      select user_id from plan_organizers where plan_id = v_plan_id
      union
      select gpp.user_id
      from group_plan_participants gpp
      where gpp.status = 'accepted'
        and gpp.proposal_id in (
          select gpp2.proposal_id from group_plan_participants gpp2
          where gpp2.source_request_id = v_primary_id
          union
          select br.group_plan_id from business_requests br
          where br.id = v_primary_id and br.group_plan_id is not null
        )
    ) x
    where uid is not null and uid is distinct from exclude_user_id
  loop
    continue when not coalesce((select notify_planning from profiles where id = v_uid), true);
    -- Item 125: through the one sender.
    perform public._send_push(v_uid, title_text, body_text,
      jsonb_build_object('type', notif_type, 'request_id', v_primary_id) || extra_data);
  end loop;
end;
$function$;
