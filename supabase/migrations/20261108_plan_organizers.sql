-- Item 88 (CLAUDE.md, "Let multiple people organize the same occasion"):
-- "Sarah's birthday could have Organizer: Allen, Co-organizers: John +
-- Emily. Everyone can help. One person might find the restaurant, another
-- invite people, another coordinate transportation, another handle
-- decorations. You don't necessarily need full task-management initially,
-- but the architecture should support multiple organizers."
--
-- Item 66 ("Add collaborative planning") already built a real co-organizer
-- concept, but scoped to the VOTING phase only (occasion_group_plan_
-- participants.is_organizer) -- once a group plan is decided and the real
-- business_requests/gathering is created, that authority evaporates: only
-- the one person whose session actually created the resulting row
-- (requester_id/host_id) can do anything with it from then on, even for a
-- plan that was never voted on at all (the far more common path -- Item
-- 83's wizard usually just submits directly, no group vote involved).
--
-- This adds a real, generic, plan-type-agnostic organizer concept hung off
-- the already-existing unified `plans` object (Phase G,
-- 20260914_plans_unified_object.sql) -- not a second, occasion-specific
-- copy -- so any future plan-type-specific authority (gatherings included)
-- can reuse the exact same table/helper rather than inventing its own.
-- Deliberately bounded to what the item's own 4 concrete examples need,
-- not full task-management: view the plan, add/manage add-on business
-- requests (find transportation/decorations/etc.), invite people, and
-- retime/relabel plan items. Accepting a specific business's offer,
-- cancelling the plan, and adding/removing organizers all stay host-only
-- -- the same "one real final decider" guardrail Item 66 already locked
-- for the voting phase, now carried through to the real resulting plan.
--
-- Scoped to business_request-destined plans only in this pass (the one
-- destination with a real multi-request "Plan" -- add-ons -- to actually
-- share authority over). A gathering-destined occasion (a party) keeps
-- its existing single-host model untouched -- a real, disclosed follow-up,
-- not silently assumed covered by the generic table below.

create table if not exists public.plan_organizers (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  added_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (plan_id, user_id)
);

create index if not exists plan_organizers_plan_idx on public.plan_organizers(plan_id);
create index if not exists plan_organizers_user_idx on public.plan_organizers(user_id);

alter table public.plan_organizers enable row level security;
-- No client policies -- every access through the SECURITY DEFINER RPCs
-- below, same posture as occasion_group_plans/recommendation_push_log.
revoke all on public.plan_organizers from public, anon, authenticated;

-- Host (plans.created_by) OR a real plan_organizers row -- one predicate,
-- reused by every RLS policy and RPC below so "who can act on this plan"
-- can never drift into two different definitions.
create or replace function public.is_plan_organizer(plan_id_param uuid, user_id_param uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.plans where id = plan_id_param and created_by = user_id_param)
    or exists (select 1 from public.plan_organizers where plan_id = plan_id_param and user_id = user_id_param);
$$;

revoke all on function public.is_plan_organizer(uuid, uuid) from public, anon;
grant execute on function public.is_plan_organizer(uuid, uuid) to authenticated;

-- Whether the caller may manage a specific business_requests row -- its
-- own requester, or an organizer of the plan behind its PRIMARY row (a
-- request's own id when it has no parent, or its parent's id when it's an
-- add-on -- so an organizer's authority covers every add-on in the plan,
-- not just the primary itself, and an add-on's own creator retains their
-- normal owner access to it too via requester_id).
create or replace function public._can_manage_business_request(request_id_param uuid, caller_id uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.business_requests br
    where br.id = request_id_param
      and (
        br.requester_id = caller_id
        or exists (
          select 1 from public.plans p
          where p.resulting_business_request_id = coalesce(br.parent_request_id, br.id)
            and public.is_plan_organizer(p.id, caller_id)
        )
      )
  );
$$;

revoke all on function public._can_manage_business_request(uuid, uuid) from public, anon;
grant execute on function public._can_manage_business_request(uuid, uuid) to authenticated;

-- Whether caller organizes the plan behind a given PRIMARY business_requests
-- id. Real bug caught during live verification, not a hypothetical: an RLS
-- policy's own USING expression runs as the QUERYING role, not the table
-- owner -- so a policy that referenced `public.plans` directly (even though
-- the table it protects, business_requests, is a different table) was
-- itself silently subject to `plans`' OWN RLS ("Users can view their own
-- plans" -- created_by = auth.uid() only), which a co-organizer always
-- fails since they aren't the plan's creator. Wrapping the cross-table
-- lookup in its own SECURITY DEFINER function (same reason
-- is_match_participant/is_group_plan_participant already exist as
-- functions rather than inline policy subqueries) is what actually lets it
-- bypass that RLS the way is_plan_organizer already does when called from
-- inside another SECURITY DEFINER function -- confirmed live: an inline
-- `exists (select 1 from public.plans ...)` predicate evaluated to false
-- for a real, confirmed organizer, while the exact same logic wrapped in
-- this function correctly evaluated to true.
create or replace function public._is_organizer_of_primary_request(primary_request_id uuid, caller_id uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.plans p
    where p.resulting_business_request_id = primary_request_id
      and public.is_plan_organizer(p.id, caller_id)
  );
$$;

revoke all on function public._is_organizer_of_primary_request(uuid, uuid) from public, anon;
grant execute on function public._is_organizer_of_primary_request(uuid, uuid) to authenticated;

create or replace function public._can_view_business_request_offers(request_id_param uuid, caller_id uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.business_requests br
    where br.id = request_id_param
      and public._is_organizer_of_primary_request(coalesce(br.parent_request_id, br.id), caller_id)
  );
$$;

revoke all on function public._can_view_business_request_offers(uuid, uuid) from public, anon;
grant execute on function public._can_view_business_request_offers(uuid, uuid) to authenticated;

-- ---- RLS: let a plan's organizers actually see the plan they're helping with ----

drop policy if exists "Plan organizers can view the resulting request" on public.business_requests;
create policy "Plan organizers can view the resulting request"
  on public.business_requests for select
  using (public._is_organizer_of_primary_request(id));

drop policy if exists "Plan organizers can view plan add-ons" on public.business_requests;
create policy "Plan organizers can view plan add-ons"
  on public.business_requests for select
  using (parent_request_id is not null and public._is_organizer_of_primary_request(parent_request_id));

drop policy if exists "Plan organizers can view offers on the plan" on public.business_request_offers;
create policy "Plan organizers can view offers on the plan"
  on public.business_request_offers for select
  using (public._can_view_business_request_offers(request_id));

-- ---- RPCs ----

-- create_plan_addon_request / invite_to_business_request / set_plan_item_time:
-- old signatures unchanged, just widening each one's ownership check from
-- "requester_id = auth.uid()" to "_can_manage_business_request()" -- a
-- plain CREATE OR REPLACE is safe here (no parameter-list change, so no
-- second overload risk per this repo's own standing gotcha).

create or replace function public.create_plan_addon_request(parent_request_id_param uuid, addon_type_param text, note_param text default null, plan_time_param time default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

  v_raw_text := v_label || case when v_parent.occasion is not null and v_parent.occasion <> 'other'
    then ' for a ' || replace(v_parent.occasion, '_', ' ') || ' celebration'
    else ' to go with an upcoming plan' end
    || case when v_plan_label is not null then ' — ' || left(v_plan_label, 200) else '' end;

  v_expires_at := coalesce(v_parent.expires_at, now() + interval '48 hours');
  if v_expires_at < now() + interval '1 hour' then
    v_expires_at := now() + interval '1 hour';
  end if;

  insert into business_requests (
    requester_id, raw_text, category, party_size, date, time_window_start,
    time_window_end, latitude, longitude, radius_miles, expires_at, occasion,
    parent_request_id, addon_type, plan_time, plan_label
  ) values (
    auth.uid(), v_raw_text, v_category, v_parent.party_size, v_parent.date,
    v_parent.time_window_start, v_parent.time_window_end, v_parent.latitude,
    v_parent.longitude, v_parent.radius_miles, v_expires_at, v_parent.occasion,
    parent_request_id_param, addon_type_param, plan_time_param, v_plan_label
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
$$;

create or replace function public.invite_to_business_request(request_id_param uuid, invitee_ids_param uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request record;
  v_proposal_id uuid;
  v_invitee_id uuid;
  v_companion_request_id uuid;
  v_expires_at timestamptz;
  v_invited_count integer := 0;
  service_key text;
  v_initiator_name text;
  v_wants_notif boolean;
begin
  select * into v_request from business_requests where id = request_id_param for update;
  if v_request is null then
    raise exception 'Request not found.';
  end if;
  if not public._can_manage_business_request(v_request.id) then
    raise exception 'You do not have permission to invite for this request.';
  end if;
  if v_request.status <> 'open' then
    raise exception 'This request is no longer open.';
  end if;
  if v_request.category is null then
    raise exception 'This request needs a category before you can invite someone.';
  end if;
  if invitee_ids_param is null or array_length(invitee_ids_param, 1) is null then
    raise exception 'Pick at least one person to invite.';
  end if;

  select proposal_id into v_proposal_id
  from group_plan_participants
  where source_request_id = request_id_param and user_id = auth.uid();

  if v_proposal_id is null then
    v_expires_at := now() + interval '48 hours';
    insert into group_plan_proposals (initiator_id, category, date, time_window_start, time_window_end, radius_miles, expires_at)
    values (auth.uid(), v_request.category, v_request.date, v_request.time_window_start, v_request.time_window_end, v_request.radius_miles, v_expires_at)
    returning id into v_proposal_id;

    insert into group_plan_participants (proposal_id, user_id, source_request_id, party_size, status, responded_at)
    values (v_proposal_id, auth.uid(), request_id_param, coalesce(v_request.party_size, 1), 'accepted', now());
  end if;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select display_name into v_initiator_name from profiles where id = auth.uid();

  foreach v_invitee_id in array invitee_ids_param loop
    continue when v_invitee_id = auth.uid();
    continue when is_blocked(auth.uid(), v_invitee_id);

    if not (
      exists (
        select 1 from friendships f
        where f.status = 'accepted'
        and ((f.user_a = auth.uid() and f.user_b = v_invitee_id) or (f.user_a = v_invitee_id and f.user_b = auth.uid()))
      )
      or exists (
        select 1 from matches m
        where (m.user_a = auth.uid() and m.user_b = v_invitee_id) or (m.user_a = v_invitee_id and m.user_b = auth.uid())
      )
    ) then
      continue;
    end if;

    insert into business_requests (
      requester_id, raw_text, category, date, time_window_start, time_window_end,
      latitude, longitude, radius_miles, expires_at
    ) values (
      v_invitee_id, v_request.raw_text, v_request.category, v_request.date, v_request.time_window_start, v_request.time_window_end,
      v_request.latitude, v_request.longitude, v_request.radius_miles, v_request.expires_at
    ) returning id into v_companion_request_id;

    begin
      insert into group_plan_participants (proposal_id, user_id, source_request_id, party_size, status)
      values (v_proposal_id, v_invitee_id, v_companion_request_id, 1, 'invited');
      v_invited_count := v_invited_count + 1;
    exception when unique_violation then
      continue;
    end;

    select coalesce(notify_planning, true) into v_wants_notif from profiles where id = v_invitee_id;
    if service_key is not null and v_wants_notif then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', v_invitee_id,
          'title', 'You''re invited to a plan',
          'body', coalesce(v_initiator_name, 'Someone you know') || ' invited you to their ' || v_request.category || ' plan.',
          'data', jsonb_build_object('type', 'group_plan_invite', 'proposal_id', v_proposal_id)
        )
      );
    end if;
  end loop;

  if v_invited_count = 0 then
    raise exception 'None of the people you picked could be invited -- they may no longer be connected.';
  end if;

  return jsonb_build_object('proposalId', v_proposal_id, 'invitedCount', v_invited_count);
end;
$$;

create or replace function public.set_plan_item_time(request_id_param uuid, plan_time_param time default null, plan_label_param text default null, clear_label boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated record;
begin
  if not public._can_manage_business_request(request_id_param) then
    raise exception 'You are not authorized to edit this plan item.';
  end if;

  update business_requests
  set
    plan_time = plan_time_param,
    plan_label = case when clear_label then null
      when plan_label_param is not null then nullif(trim(plan_label_param), '')
      else plan_label end
  where id = request_id_param
  returning id, plan_time, plan_label into v_updated;

  if v_updated.id is null then
    raise exception 'Request not found.';
  end if;

  return jsonb_build_object('requestId', v_updated.id, 'planTime', v_updated.plan_time, 'planLabel', v_updated.plan_label);
end;
$$;

-- Real, generic organizer management -- takes a business_request id (the
-- primary or any of its add-ons, whichever the client happens to be
-- looking at) and resolves the plan behind it internally, so the client
-- never has to know about plans.id at all.

create or replace function public.get_plan_organizers(business_request_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_primary_id uuid;
  v_plan record;
  v_host_name text;
  v_organizers jsonb;
begin
  select coalesce(parent_request_id, id) into v_primary_id from business_requests where id = business_request_id_param;
  if v_primary_id is null then
    raise exception 'Request not found.';
  end if;

  select p.* into v_plan from plans p where p.resulting_business_request_id = v_primary_id order by created_at desc limit 1;
  if v_plan.id is null then
    raise exception 'This request has no plan yet.';
  end if;

  if not public.is_plan_organizer(v_plan.id, auth.uid()) then
    raise exception 'You do not have access to this plan.';
  end if;

  select display_name into v_host_name from profiles where id = v_plan.created_by;

  select coalesce(jsonb_agg(jsonb_build_object('id', pr.id, 'displayName', pr.display_name, 'addedAt', po.created_at) order by po.created_at), '[]'::jsonb)
  into v_organizers
  from plan_organizers po
  join profiles pr on pr.id = po.user_id
  where po.plan_id = v_plan.id;

  return jsonb_build_object(
    'planId', v_plan.id,
    'hostId', v_plan.created_by,
    'hostName', v_host_name,
    'isHost', v_plan.created_by = auth.uid(),
    'organizers', v_organizers
  );
end;
$$;

create or replace function public.add_plan_organizer(business_request_id_param uuid, friend_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_primary_id uuid;
  v_plan record;
  v_host_name text;
  v_wants_notif boolean;
  service_key text;
begin
  select coalesce(parent_request_id, id) into v_primary_id from business_requests where id = business_request_id_param;
  if v_primary_id is null then
    raise exception 'Request not found.';
  end if;

  select p.* into v_plan from plans p where p.resulting_business_request_id = v_primary_id order by created_at desc limit 1;
  if v_plan.id is null then
    raise exception 'This request has no plan yet.';
  end if;
  if v_plan.created_by <> auth.uid() then
    raise exception 'Only the plan''s host can add a co-organizer.';
  end if;
  if friend_user_id = auth.uid() then
    raise exception 'You''re already organizing this plan.';
  end if;
  if is_blocked(auth.uid(), friend_user_id) then
    raise exception 'You can''t add this person.';
  end if;
  if not (
    exists (
      select 1 from friendships f
      where f.status = 'accepted'
      and ((f.user_a = auth.uid() and f.user_b = friend_user_id) or (f.user_a = friend_user_id and f.user_b = auth.uid()))
    )
    or exists (
      select 1 from matches m
      where (m.user_a = auth.uid() and m.user_b = friend_user_id) or (m.user_a = friend_user_id and m.user_b = auth.uid())
    )
  ) then
    raise exception 'You can only add a real connected friend as a co-organizer.';
  end if;

  insert into plan_organizers (plan_id, user_id, added_by)
  values (v_plan.id, friend_user_id, auth.uid())
  on conflict (plan_id, user_id) do nothing;

  select display_name into v_host_name from profiles where id = auth.uid();
  select coalesce(notify_planning, true) into v_wants_notif from profiles where id = friend_user_id;
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  if service_key is not null and v_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', friend_user_id,
        'title', 'You''re a co-organizer',
        'body', coalesce(v_host_name, 'Someone you know') || ' added you as a co-organizer for ' || coalesce(v_plan.title, 'a plan') || '.',
        'data', jsonb_build_object('type', 'plan_organizer_added', 'request_id', v_primary_id)
      )
    );
  end if;

  return jsonb_build_object('planId', v_plan.id, 'addedUserId', friend_user_id);
end;
$$;

create or replace function public.remove_plan_organizer(business_request_id_param uuid, user_id_param uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_primary_id uuid;
  v_plan record;
begin
  select coalesce(parent_request_id, id) into v_primary_id from business_requests where id = business_request_id_param;
  if v_primary_id is null then
    raise exception 'Request not found.';
  end if;

  select p.* into v_plan from plans p where p.resulting_business_request_id = v_primary_id order by created_at desc limit 1;
  if v_plan.id is null then
    raise exception 'This request has no plan yet.';
  end if;
  if v_plan.created_by <> auth.uid() then
    raise exception 'Only the plan''s host can remove a co-organizer.';
  end if;

  delete from plan_organizers where plan_id = v_plan.id and user_id = user_id_param;
end;
$$;

revoke all on function public.get_plan_organizers(uuid) from public, anon;
grant execute on function public.get_plan_organizers(uuid) to authenticated;
revoke all on function public.add_plan_organizer(uuid, uuid) from public, anon;
grant execute on function public.add_plan_organizer(uuid, uuid) to authenticated;
revoke all on function public.remove_plan_organizer(uuid, uuid) from public, anon;
grant execute on function public.remove_plan_organizer(uuid, uuid) to authenticated;

-- Real integration point, not a parallel concept: a group-voted occasion
-- plan (Item 66/67) already tracks its own real co-organizers
-- (occasion_group_plan_participants.is_organizer) during the voting
-- phase -- once it's decided and linked to the real resulting plan, that
-- same set of people should keep their organizing authority on the real
-- plan too, not lose it the moment voting ends. The host is never
-- inserted as a row here (is_plan_organizer already treats plans.created_by
-- as an implicit organizer); only genuinely-promoted, joined co-organizers
-- who aren't the host are carried forward.
create or replace function public.link_occasion_group_plan_to_plan(group_plan_id_param uuid, resulting_gathering_id_param uuid default null, resulting_business_request_id_param uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_id uuid;
begin
  if not is_occasion_group_plan_participant(group_plan_id_param, auth.uid()) then
    raise exception 'You are not part of this plan.';
  end if;

  if not exists (select 1 from occasion_group_plans where id = group_plan_id_param and status = 'decided') then
    return;
  end if;

  select id into v_plan_id from plans
  where created_by = auth.uid()
    and (
      (resulting_gathering_id_param is not null and resulting_gathering_id = resulting_gathering_id_param)
      or (resulting_business_request_id_param is not null and resulting_business_request_id = resulting_business_request_id_param)
    )
  order by created_at desc
  limit 1;

  if v_plan_id is not null then
    update occasion_group_plans
    set resulting_plan_id = v_plan_id, status = 'fulfilled'
    where id = group_plan_id_param and status = 'decided';

    insert into plan_organizers (plan_id, user_id, added_by)
    select v_plan_id, ogpp.user_id, (select created_by from plans where id = v_plan_id)
    from occasion_group_plan_participants ogpp
    where ogpp.group_plan_id = group_plan_id_param
      and ogpp.is_organizer = true
      and ogpp.status = 'joined'
      and ogpp.user_id <> (select created_by from plans where id = v_plan_id)
    on conflict (plan_id, user_id) do nothing;
  end if;
end;
$$;

revoke all on function public.link_occasion_group_plan_to_plan(uuid, uuid, uuid) from public, anon;
grant execute on function public.link_occasion_group_plan_to_plan(uuid, uuid, uuid) to authenticated;
