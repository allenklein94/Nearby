-- Dietary needs for group plans (invite flow) and plan add-ons.
--
-- GROUP PLAN: each participant declares their OWN needs (never copied from the inviter: that would attribute one person's needs
-- to another). Declarations live in an owner-only table (the roster policy on group_plan_participants lets every participant
-- read every row, so they must not go there). confirm_group_plan puts the UNION of accepted participants' needs on the single
-- request a business sees -- a set, with no attribution to anyone.
-- ADD-ON: a dessert add-on (the only food-type add-on, a Bakeries request) inherits its parent plan's needs (same party);
-- other add-on types (flowers, photographer, ride...) get none.

create table if not exists public.group_plan_participant_dietary (
  proposal_id uuid not null references public.group_plan_proposals(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  dietary text[] not null,
  updated_at timestamptz not null default now(),
  primary key (proposal_id, user_id),
  constraint group_plan_participant_dietary_check
    check (dietary <@ array['vegetarian','vegan','gluten_free','dairy_free','nut_allergy','shellfish_allergy','halal','kosher']::text[] and cardinality(dietary) between 1 and 8)
);
alter table public.group_plan_participant_dietary enable row level security;
revoke all on public.group_plan_participant_dietary from public, anon, authenticated;
grant select on public.group_plan_participant_dietary to authenticated;
drop policy if exists "Own group plan dietary" on public.group_plan_participant_dietary;
create policy "Own group plan dietary" on public.group_plan_participant_dietary for select using (user_id = auth.uid());

create or replace function public.set_my_group_plan_dietary(proposal_id_param uuid, dietary_param text[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_clean text[];
begin
  if not exists (
    select 1 from group_plan_participants gpp
    join group_plan_proposals gp on gp.id = gpp.proposal_id
    where gpp.proposal_id = proposal_id_param and gpp.user_id = auth.uid()
      and gpp.status in ('invited', 'accepted') and gp.status = 'pending'
  ) then
    raise exception 'You are not part of an open group plan with this id.';
  end if;
  v_clean := public.normalize_dietary(dietary_param);
  if cardinality(v_clean) = 0 then
    delete from group_plan_participant_dietary where proposal_id = proposal_id_param and user_id = auth.uid();
  else
    insert into group_plan_participant_dietary (proposal_id, user_id, dietary)
    values (proposal_id_param, auth.uid(), v_clean)
    on conflict (proposal_id, user_id) do update set dietary = excluded.dietary, updated_at = now();
  end if;
end;
$fn$;
revoke all on function public.set_my_group_plan_dietary(uuid, text[]) from public, anon;
grant execute on function public.set_my_group_plan_dietary(uuid, text[]) to authenticated;

CREATE OR REPLACE FUNCTION public.confirm_group_plan(proposal_id_param uuid, exclude_user_ids_param uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_proposal record;
  v_final_party_size integer := 0;
  v_final_count integer := 0;
  v_has_blocked_pair boolean;
  v_request_id uuid;
  v_expires_at timestamptz;
  v_notified_count integer;
  v_avail_count integer;
  v_lat double precision;
  v_lng double precision;
  v_notify_row record;
  service_key text;
begin
  select * into v_proposal from group_plan_proposals where id = proposal_id_param for update;
  if v_proposal is null then
    raise exception 'Group plan not found.';
  end if;
  if v_proposal.initiator_id <> auth.uid() then
    raise exception 'Only the person who proposed this group plan can confirm it.';
  end if;
  if v_proposal.status <> 'pending' then
    raise exception 'This group plan has already been confirmed or cancelled.';
  end if;
  if v_proposal.agreed_budget_max is null then
    raise exception 'Set an agreed budget before confirming the group plan.';
  end if;

  -- Explicit initiator choice: removes someone even if they already
  -- accepted ("continue without Sarah" after she said yes).
  update group_plan_participants
  set status = 'left'
  where proposal_id = proposal_id_param and user_id = any(coalesce(exclude_user_ids_param, array[]::uuid[]));

  select coalesce(sum(party_size + guest_count), 0), count(*)
  into v_final_party_size, v_final_count
  from group_plan_participants
  where proposal_id = proposal_id_param and status = 'accepted';

  if v_final_count < 2 then
    raise exception 'A group plan needs at least 2 people who have accepted.';
  end if;

  -- Real all-pairs block check across the final accepted roster (post any
  -- initiator exclusion above). A generic message, same posture as every
  -- other blocked-pair rejection in this schema -- never reveals which side
  -- blocked which.
  select exists (
    select 1
    from group_plan_participants gpp1
    join group_plan_participants gpp2
      on gpp1.proposal_id = gpp2.proposal_id and gpp1.user_id < gpp2.user_id
    join blocks b
      on (b.blocker_id = gpp1.user_id and b.blocked_id = gpp2.user_id)
      or (b.blocker_id = gpp2.user_id and b.blocked_id = gpp1.user_id)
    where gpp1.proposal_id = proposal_id_param
      and gpp1.status = 'accepted'
      and gpp2.status = 'accepted'
  ) into v_has_blocked_pair;

  if v_has_blocked_pair then
    raise exception 'This group can''t be confirmed as-is. Review who''s accepted and exclude someone if needed, then try again.';
  end if;

  -- Finalizing the roster: anyone who never actually accepted (still
  -- invited, or declined) is not part of the confirmed group.
  update group_plan_participants
  set status = 'left'
  where proposal_id = proposal_id_param and status in ('invited', 'declined');

  v_expires_at := case
    when v_proposal.date is not null and v_proposal.time_window_end is not null then (v_proposal.date + v_proposal.time_window_end)::timestamptz
    when v_proposal.date is not null then (v_proposal.date + time '23:59:59')::timestamptz
    else now() + interval '48 hours'
  end;
  if v_expires_at < now() + interval '1 hour' then
    v_expires_at := now() + interval '1 hour';
  end if;

  -- Real coordinates from the initiator's own already-collected source
  -- request -- never re-typed, same discipline Phase 3's gathering-
  -- sourced requests already established.
  select br.latitude, br.longitude into v_lat, v_lng
  from business_requests br
  join group_plan_participants gpp on gpp.source_request_id = br.id
  where gpp.proposal_id = proposal_id_param and gpp.user_id = v_proposal.initiator_id;

  insert into business_requests (
    requester_id, raw_text, category, party_size, budget_max,
    date, time_window_start, time_window_end, latitude, longitude,
    radius_miles, expires_at, group_plan_id, dietary
  ) values (
    v_proposal.initiator_id,
    'Group plan: ' || v_proposal.category || ' for ' || v_final_party_size || ' people',
    v_proposal.category, v_final_party_size, v_proposal.agreed_budget_max,
    v_proposal.date, v_proposal.time_window_start, v_proposal.time_window_end,
    v_lat, v_lng, v_proposal.radius_miles, v_expires_at, proposal_id_param,
    coalesce((
      select array_agg(distinct x.d order by x.d) from (
        select unnest(gpd.dietary) as d
        from group_plan_participants gpp
        join group_plan_participant_dietary gpd on gpd.proposal_id = gpp.proposal_id and gpd.user_id = gpp.user_id
        where gpp.proposal_id = proposal_id_param and gpp.status = 'accepted'
        union
        select unnest(sbr.dietary)
        from group_plan_participants gpp
        join business_requests sbr on sbr.id = gpp.source_request_id
        where gpp.proposal_id = proposal_id_param and gpp.status = 'accepted'
      ) x
    ), '{}')
  ) returning id into v_request_id;

  update business_requests br
  set status = 'merged', superseded_by_group_plan_id = proposal_id_param
  from group_plan_participants gpp
  where gpp.proposal_id = proposal_id_param
  and gpp.status = 'accepted'
  and br.id = gpp.source_request_id
  and br.status = 'open';

  -- Finding C1's actual fix: a merged parent's own already-generated
  -- offers were never touched before this line -- they were left
  -- pending/offered forever, rendered as a blank row on the business
  -- dashboard and a live-but-always-rejected "Accept This Offer" button
  -- on the consumer's own request-detail screen. Expired, not cancelled
  -- -- the terms weren't declined, they were superseded by the group
  -- plan's own new shared request.
  update business_request_offers bro
  set status = 'expired'
  from group_plan_participants gpp
  where gpp.proposal_id = proposal_id_param
  and gpp.status = 'accepted'
  and bro.request_id = gpp.source_request_id
  and bro.status in ('pending', 'offered');

  update group_plan_proposals
  set status = 'confirmed', confirmed_at = now(), resulting_request_id = v_request_id
  where id = proposal_id_param;

  select public._business_request_fanout(v_request_id, v_lat, v_lng, v_proposal.radius_miles) into v_notified_count;
  select public._match_request_to_availability(v_request_id, v_lat, v_lng, v_proposal.radius_miles, v_proposal.category, v_proposal.date, v_proposal.time_window_start, v_proposal.time_window_end) into v_avail_count;
  v_notified_count := v_notified_count + coalesce(v_avail_count, 0);

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  if service_key is not null then
    for v_notify_row in
      select user_id from group_plan_participants where proposal_id = proposal_id_param and status = 'accepted' and user_id <> v_proposal.initiator_id
    loop
      continue when not coalesce((select notify_planning from profiles where id = v_notify_row.user_id), true);
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', v_notify_row.user_id,
          'title', 'Your group plan is live!',
          'body', 'Your ' || v_proposal.category || ' group plan was sent to nearby businesses.',
          'data', jsonb_build_object('type', 'group_plan_confirmed', 'proposal_id', proposal_id_param, 'request_id', v_request_id)
        )
      );
    end loop;
  end if;

  return jsonb_build_object('success', true, 'requestId', v_request_id, 'notifiedCount', v_notified_count, 'partySize', v_final_party_size);
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_plan_addon_request(parent_request_id_param uuid, addon_type_param text, note_param text DEFAULT NULL::text, plan_time_param time without time zone DEFAULT NULL::time without time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_parent record;
  v_category text;
  v_business_major text;
  v_label text;
  v_plan_label text;
  v_request_id uuid;
  v_expires_at timestamptz;
  v_raw_text text;
  v_existing_open_id uuid;
  v_notified_count integer := 0;
  v_avail_new_count integer := 0;
  v_ai_new_count integer := 0;
begin
  if addon_type_param is null or addon_type_param not in ('dessert', 'flowers', 'photographer', 'decorations', 'transportation', 'gift', 'entertainment') then
    raise exception 'Invalid add-on type';
  end if;

  select * into v_parent from business_requests
    where id = parent_request_id_param
    for update;
  if not found then
    raise exception 'Request not found.';
  end if;
  if not public._can_manage_business_request(v_parent.id) then
    raise exception 'You are not authorized to add to this plan.';
  end if;
  if v_parent.parent_request_id is not null then
    raise exception 'Add-ons cannot themselves have add-ons.';
  end if;
  if v_parent.status = 'cancelled' then
    raise exception 'This plan was cancelled -- add-ons cannot be added to a cancelled request.';
  end if;

  v_plan_label := nullif(trim(coalesce(note_param, '')), '');

  select id into v_existing_open_id from business_requests
    where parent_request_id = parent_request_id_param
    and addon_type = addon_type_param
    and status = 'open'
    and plan_time is not distinct from plan_time_param
    and plan_label is not distinct from v_plan_label
    limit 1;
  if v_existing_open_id is not null then
    raise exception 'You already have an open % request for this plan at that time.', addon_type_param;
  end if;

  v_category := case addon_type_param
    when 'dessert' then 'Bakeries'
    when 'flowers' then 'Florist'
    when 'photographer' then 'Photography'
    when 'decorations' then 'Party & Event Decor'
    when 'gift' then 'Gift Shop'
    when 'entertainment' then 'Music'
    else null
  end;
  v_business_major := case addon_type_param
    when 'dessert' then 'food_drink'
    when 'flowers' then 'shopping'
    when 'photographer' then 'arts_culture_learning'
    when 'decorations' then 'shopping'
    when 'gift' then 'shopping'
    when 'entertainment' then 'entertainment_nightlife'
    when 'transportation' then 'auto_transportation'
  end;
  v_label := case addon_type_param
    when 'dessert' then 'Dessert'
    when 'flowers' then 'Flowers'
    when 'photographer' then 'Photographer'
    when 'decorations' then 'Decorations'
    when 'transportation' then 'Transportation'
    when 'gift' then 'Gift'
    when 'entertainment' then 'Entertainment'
  end;

  -- Item 103: a real occasion-aware label, not a hardcoded "celebration"
  -- -- see this migration's own header comment for the live-confirmed bug
  -- this replaces ("Flowers for a moving celebration").
  v_raw_text := v_label || case when v_parent.occasion is not null and v_parent.occasion <> 'other'
    then ' for ' || (case when v_parent.occasion in ('anniversary', 'engagement', 'achievement') then 'an ' else 'a ' end) || public._occasion_noun(v_parent.occasion)
    else ' to go with an upcoming plan' end
    || case when v_plan_label is not null then ' — ' || left(v_plan_label, 200) else '' end;

  v_expires_at := coalesce(v_parent.expires_at, now() + interval '48 hours');
  if v_expires_at < now() + interval '1 hour' then
    v_expires_at := now() + interval '1 hour';
  end if;

  insert into business_requests (
    requester_id, raw_text, category, party_size, date, time_window_start,
    time_window_end, latitude, longitude, radius_miles, expires_at, occasion,
    parent_request_id, addon_type, plan_time, plan_label, dietary
  ) values (
    auth.uid(), v_raw_text, v_category, v_parent.party_size, v_parent.date,
    v_parent.time_window_start, v_parent.time_window_end, v_parent.latitude,
    v_parent.longitude, v_parent.radius_miles, v_expires_at, v_parent.occasion,
    parent_request_id_param, addon_type_param, plan_time_param, v_plan_label,
    case when addon_type_param = 'dessert' then v_parent.dietary else '{}' end
  ) returning id into v_request_id;

  select public._business_request_fanout(
    v_request_id, v_parent.latitude, v_parent.longitude, v_parent.radius_miles,
    case when v_category is not null then array[v_category] else null end,
    case when v_category is null then v_business_major else null end
  ) into v_notified_count;

  if v_category is not null then
    select public._match_request_to_availability(v_request_id, v_parent.latitude, v_parent.longitude, v_parent.radius_miles, v_category, v_parent.date, v_parent.time_window_start, v_parent.time_window_end, null, v_parent.party_size) into v_avail_new_count;
    select public._ai_auto_respond_to_business_requests(v_request_id, v_parent.latitude, v_parent.longitude, v_parent.radius_miles, v_category, v_parent.party_size, v_parent.time_window_start, v_parent.time_window_end) into v_ai_new_count;
  end if;

  v_notified_count := v_notified_count + coalesce(v_avail_new_count, 0) + coalesce(v_ai_new_count, 0);

  return jsonb_build_object('requestId', v_request_id, 'addonType', addon_type_param, 'category', v_category, 'notifiedCount', v_notified_count);
end;
$function$;
