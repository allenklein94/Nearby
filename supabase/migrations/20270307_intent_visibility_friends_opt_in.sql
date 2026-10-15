-- Item 93 (owner, 2026-10-15): align Phase D ("People you know are also asking for this" + "Make It a Group Plan") with item 92.
-- 1. Opt-in: intent_visibility is OFF ('nobody') by default and for EVERY existing profile (nobody is silently opted in; the
--    old default 'friends_and_matches' was never a choice). The one opt-in value is 'friends' (Settings).
-- 2. Accepted friends only: dating matches no longer see, count toward, get pushed about or get proposed from someone's open
--    request (all four readers of the setting change together: one rule).
-- 3. No raw text: get_connected_open_business_requests returns structured facts only (category, date, party size) plus the
--    friend's name/photo; raw_text and match_id are dropped (return type changes -> drop + create, single overload).
-- 4. Consent-to-merge (respond_to_group_plan / confirm_group_plan) is unchanged.
-- Bodies of the three replaced functions are the LIVE bodies with only the lines above changed.

begin;

alter table public.profiles drop constraint profiles_intent_visibility_check;
select set_config('app.trusted_update', 'true', true);
update public.profiles set intent_visibility = 'nobody' where intent_visibility is distinct from 'nobody';
alter table public.profiles alter column intent_visibility set default 'nobody';
alter table public.profiles add constraint profiles_intent_visibility_check check (intent_visibility = any (array['friends'::text, 'nobody'::text]));

drop function if exists public.get_connected_open_business_requests(text, date, date);
CREATE FUNCTION public.get_connected_open_business_requests(category_param text DEFAULT NULL::text, date_start_param date DEFAULT NULL::date, date_end_param date DEFAULT NULL::date)
 RETURNS TABLE(id uuid, requester_id uuid, requester_display_name text, requester_photo_url text, category text, date date, party_size integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with connected as (
    select case when user_a = auth.uid() then user_b else user_a end as friend_id
    from friendships
    where status = 'accepted' and (user_a = auth.uid() or user_b = auth.uid())
  )
  select
    br.id, br.requester_id, p.display_name, p.photo_url, br.category, br.date, br.party_size
  from business_requests br
  join connected c on c.friend_id = br.requester_id
  join profiles p on p.id = br.requester_id
  where br.status = 'open'
  and br.expires_at > now()
  and br.requester_id <> auth.uid()
  and p.intent_visibility = 'friends'
  and not is_blocked(auth.uid(), br.requester_id)
  and (category_param is null or br.category = category_param)
  and (
    date_start_param is null
    or br.date is null
    or br.date between date_start_param and coalesce(date_end_param, date_start_param)
  )
  order by br.created_at desc
  limit 4;
$function$;
revoke all on function public.get_connected_open_business_requests(text, date, date) from public, anon;
grant execute on function public.get_connected_open_business_requests(text, date, date) to authenticated;

CREATE OR REPLACE FUNCTION public.get_my_group_intent_signals()
 RETURNS TABLE(category text, request_count bigint, requester_names text[], soonest_date date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with connected as (
    select case when user_a = auth.uid() then user_b else user_a end as friend_id
    from friendships
    where status = 'accepted' and (user_a = auth.uid() or user_b = auth.uid())
  ),
  open_reqs as (
    select br.category, br.date, p.display_name, br.requester_id
    from business_requests br
    join connected c on c.friend_id = br.requester_id
    join profiles p on p.id = br.requester_id
    where br.status = 'open'
    and br.expires_at > now()
    and br.category is not null
    and br.requester_id <> auth.uid()
    and p.intent_visibility = 'friends'
    and not is_blocked(auth.uid(), br.requester_id)
  )
  select
    category,
    count(distinct requester_id) as request_count,
    (array_agg(display_name order by date nulls last))[1:5] as requester_names,
    min(date) as soonest_date
  from open_reqs
  group by category
  having count(distinct requester_id) >= 2
  order by count(distinct requester_id) desc, min(date) asc nulls last
  limit 5;
$function$;

CREATE OR REPLACE FUNCTION public.notify_group_intent_threshold()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_connected_user record;
  v_prior_count integer;
  v_wants_notif boolean;
begin
  if new.status <> 'open' or new.category is null then
    return new;
  end if;

  -- An opted-out requester's own new row should never count toward
  -- crossing anyone else's group-intent threshold either -- mirrors the
  -- read RPC's own filter exactly, not a separate rule.
  if not exists (
    select 1 from profiles where id = new.requester_id and intent_visibility = 'friends'
  ) then
    return new;
  end if;


  for v_connected_user in
    select case when f.user_a = new.requester_id then f.user_b else f.user_a end as user_id
    from friendships f
    where f.status = 'accepted' and (f.user_a = new.requester_id or f.user_b = new.requester_id)
  loop
    -- How many of THIS connected user's own connections already have a
    -- real open request in this category, not counting the new row?
    -- Mirrors get_my_group_intent_signals()'s own connected-set + real
    -- open/expiry/category/intent_visibility filters exactly.
    select count(distinct br.requester_id) into v_prior_count
    from business_requests br
    join profiles p2 on p2.id = br.requester_id
    where br.status = 'open'
      and br.expires_at > now()
      and br.category = new.category
      and br.id <> new.id
      and br.requester_id <> v_connected_user.user_id
      and p2.intent_visibility = 'friends'
      and (
        exists (
          select 1 from friendships f2
          where f2.status = 'accepted'
          and ((f2.user_a = v_connected_user.user_id and f2.user_b = br.requester_id)
            or (f2.user_a = br.requester_id and f2.user_b = v_connected_user.user_id))
        )
      );

    -- Fire exactly once, at the real 1 -> 2 crossing -- never again for
    -- the 3rd/4th/etc. request in the same category, so this can't nag.
    if v_prior_count = 1 then
      select coalesce(notify_discovery, true) into v_wants_notif from profiles where id = v_connected_user.user_id;
      if v_wants_notif then
        perform public._send_push(v_connected_user.user_id, 'A few people you know want this too', '2 or more people you''re connected to are looking for ' || new.category || ' right now.', jsonb_build_object('type', 'group_intent_signal', 'category', new.category));
      end if;
    end if;
  end loop;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.propose_group_plan(source_request_id_param uuid, invitee_source_request_ids_param uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_part_id uuid;
  v_source record;
  v_proposal_id uuid;
  v_invitee_id uuid;
  v_invitee_request record;
  v_min_budget integer;
  v_max_budget integer;
  v_expires_at timestamptz;
  v_participant_count integer;
  v_initiator_name text;
  v_wants_notif boolean;
begin
  select * into v_source from business_requests where id = source_request_id_param and requester_id = auth.uid() for update;
  if v_source is null then
    raise exception 'You do not own this request.';
  end if;
  if v_source.status <> 'open' then
    raise exception 'This request is no longer open.';
  end if;
  if v_source.category is null then
    raise exception 'A group plan needs a real category.';
  end if;
  if invitee_source_request_ids_param is null or array_length(invitee_source_request_ids_param, 1) is null then
    raise exception 'Invite at least one connected person to form a group plan.';
  end if;

  v_min_budget := v_source.budget_max;
  v_max_budget := v_source.budget_max;
  v_expires_at := now() + interval '48 hours';

  insert into group_plan_proposals (initiator_id, category, date, time_window_start, time_window_end, radius_miles, expires_at)
  values (auth.uid(), v_source.category, v_source.date, v_source.time_window_start, v_source.time_window_end, v_source.radius_miles, v_expires_at)
  returning id into v_proposal_id;

  -- Rule 3: the initiator is a real participant like everyone else, not a
  -- special row -- they just consent by proposing.
  begin
    insert into group_plan_participants (proposal_id, user_id, source_request_id, party_size, status, responded_at)
    values (v_proposal_id, auth.uid(), source_request_id_param, coalesce(v_source.party_size, 1), 'accepted', now());
  exception when unique_violation then
    raise exception 'This request is already part of another pending group plan.';
  end;

  select display_name into v_initiator_name from profiles where id = auth.uid();

  foreach v_invitee_id in array invitee_source_request_ids_param loop
    select br.*, p.display_name into v_invitee_request
    from business_requests br
    join profiles p on p.id = br.requester_id
    where br.id = v_invitee_id
    and br.status = 'open'
    and br.requester_id <> auth.uid()
    and p.intent_visibility = 'friends'
    and not is_blocked(auth.uid(), br.requester_id)
    and (
      exists (
        select 1 from friendships f
        where f.status = 'accepted'
        and ((f.user_a = auth.uid() and f.user_b = br.requester_id) or (f.user_a = br.requester_id and f.user_b = auth.uid()))
      )
    )
    for update of br;

    if v_invitee_request is null or v_invitee_request.category is distinct from v_source.category then
      -- Not a real, still-open, genuinely-connected, unblocked, same-category
      -- request -- silently skipped rather than failing the whole
      -- proposal. The client only ever sources this list from
      -- get_connected_open_business_requests scoped to this same
      -- category (and, as of this fix, already block-filtered), so a
      -- mismatch here means the world changed between fetch and submit
      -- (e.g. it just got fulfilled, or a block was created), not an
      -- abuse attempt worth surfacing as a hard error.
      v_invitee_request := null;
      continue;
    end if;

    begin
      insert into group_plan_participants (proposal_id, user_id, source_request_id, party_size, status)
      values (v_proposal_id, v_invitee_request.requester_id, v_invitee_id, coalesce(v_invitee_request.party_size, 1), 'invited')
      on conflict (proposal_id, user_id) do nothing
      returning id into v_part_id;
      -- Item 125: recorded as INVITATION_SENT
      if v_part_id is not null then
        perform public._emit_event('INVITATION_SENT', 'group_plan_participant', v_part_id, auth.uid(), 'propose_group_plan',
      jsonb_build_object('participant_id', v_part_id, 'proposal_id', v_proposal_id, 'request_id', v_invitee_id, 'invitee_id', v_invitee_request.requester_id), 'INVITATION_SENT:' || v_part_id);
      end if;
    exception when unique_violation then
      -- Finding C3: this source_request_id is already an active
      -- (invited/accepted) participant in a different, concurrently-
      -- pending proposal -- same silent-skip treatment as any other
      -- invitee whose request changed between fetch and submit, not a
      -- hard error for the whole proposal.
      v_invitee_request := null;
      continue;
    end;

    if v_invitee_request.budget_max is not null then
      v_min_budget := least(coalesce(v_min_budget, v_invitee_request.budget_max), v_invitee_request.budget_max);
      v_max_budget := greatest(coalesce(v_max_budget, v_invitee_request.budget_max), v_invitee_request.budget_max);
    end if;

    select coalesce(notify_planning, true) into v_wants_notif from profiles where id = v_invitee_request.requester_id;
    if v_wants_notif then
      perform public._send_push(v_invitee_request.requester_id, 'Make this a group plan?', coalesce(v_initiator_name, 'Someone you know') || ' wants to turn your ' || v_source.category || ' request into a shared group plan.', jsonb_build_object('type', 'group_plan_invite', 'proposal_id', v_proposal_id));
    end if;

    v_invitee_request := null;
  end loop;

  update group_plan_proposals set proposed_budget_min = v_min_budget, proposed_budget_max = v_max_budget where id = v_proposal_id;

  select count(*) into v_participant_count from group_plan_participants where proposal_id = v_proposal_id;
  if v_participant_count < 2 then
    raise exception 'None of the people you invited could be added -- they may no longer be connected, or their request may have changed.';
  end if;

  return v_proposal_id;
end;
$function$;

commit;
