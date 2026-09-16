-- Item 97 (CLAUDE.md, "Add 'Invite without revealing the surprise'"):
-- inviting John into Sarah's (possibly surprise) birthday plan is
-- supposed to tell HIM "You're helping plan Sarah's birthday" while
-- Sarah herself never learns anything at all. Item 96 already made the
-- second half of that structurally true -- the celebrated person can
-- never be invited/organizer-promoted onto their own surprise plan
-- (_surprise_excluded_friend_id_for_business_request + a trigger
-- backstop). This migration closes the first half, which turned out to
-- be missing even for a NON-surprise plan: every real "you're invited to
-- help with this business-request-destined plan" surface --
-- invite_to_business_request's push, add_plan_organizer's push, and
-- get_plan_chat_info's own returned "title" (which feeds both the Plan
-- summary card and the Plan Chat header, per Items 89/90) -- all sourced
-- their text from business_requests.raw_text/category or plans.title,
-- which is *always* the privacy-scrubbed, name-free text Item 69 composes
-- for the BUSINESS's own eyes (composeCelebrationAskTextForBusiness).
-- That scrubbing is correct for a business, which should never learn a
-- name -- but it was silently also hiding the name from a real, trusted,
-- newly-invited PERSON, who has every reason to know what they're
-- actually helping plan.
--
-- Fix: reveal the real linked occasion's own title/who-for/occasion-type
-- (via _occasion_context_for_business_request, "Occasion architecture
-- should not be a silo") to a genuine plan participant -- safe to do
-- unconditionally, because the one person this must never reach (the
-- celebrated friend, when surprise_mode is on) can structurally never
-- become a participant in the first place (Item 96), and none of these
-- three functions is ever reachable by the business side.

-- ---- _occasion_context_for_business_request: also return the real
-- title (e.g. "Sarah's Birthday 🎂"), not just occasion_type/who_for_name.
-- Column-list change on an unchanged argument list -- explicit drop first,
-- per this repo's own RETURNS TABLE gotcha. Every existing caller selects
-- occasion_type/who_for_name by name into two vars, so a third returned
-- column is a no-op for them.
--
-- Real vulnerability caught and fixed here, not hypothetical: this
-- function has been callable directly by `authenticated` since it was
-- first created (Item 78, 20261102_occasion_aware_notifications.sql),
-- which only ever revoked it from `public, anon` -- Supabase's own
-- `ALTER DEFAULT PRIVILEGES` for this schema auto-grants EXECUTE on every
-- new function to `authenticated` too (confirmed live via pg_default_acl),
-- so that revoke line alone never actually closed it off, unlike this
-- codebase's own sibling internal helpers
-- (_surprise_excluded_friend_id_for_business_request,
-- _notify_other_plan_participants) which already explicitly revoke from
-- `authenticated` as well. Concretely: any signed-in user could call this
-- with an arbitrary request_id and learn the linked occasion's real
-- who_for_name/title for ANY business request in the system -- including
-- a surprise one, directly defeating Item 96's whole privacy design. Now
-- that this function also returns the full composed title, the exposure
-- is worse than before if left unfixed -- closed below.

drop function if exists public._occasion_context_for_business_request(uuid);

create or replace function public._occasion_context_for_business_request(request_id_param uuid)
returns table(occasion_type text, who_for_name text, title text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    coalesce(o.occasion_type, ogp.occasion_type),
    coalesce(o.who_for_name, ogp.who_for_name),
    coalesce(o.title, ogp.title)
  from public.plans pl
  left join public.occasions o on o.resulting_plan_id = pl.id
  left join public.occasion_group_plans ogp on ogp.resulting_plan_id = pl.id
  where pl.resulting_business_request_id = request_id_param
  and (o.id is not null or ogp.id is not null)
  limit 1;
$$;

revoke all on function public._occasion_context_for_business_request(uuid) from public, anon, authenticated;

-- ---- get_plan_chat_info: prefer the real occasion title over the
-- generic plans.title; also return occasionType/whoForName so the client
-- can render an explicit "you're helping plan X's Y" banner rather than
-- relying on the title alone. Unchanged signature -- plain CREATE OR
-- REPLACE is safe.

create or replace function public.get_plan_chat_info(business_request_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_primary_id uuid;
  v_plan record;
  v_occ_type text;
  v_occ_who text;
  v_occ_title text;
begin
  select coalesce(parent_request_id, id) into v_primary_id from business_requests where id = business_request_id_param;
  if v_primary_id is null then
    raise exception 'Request not found.';
  end if;

  select p.* into v_plan from plans p where p.resulting_business_request_id = v_primary_id order by created_at desc limit 1;
  if v_plan.id is null then
    raise exception 'This request has no plan yet.';
  end if;
  if not public.is_plan_participant(v_plan.id, auth.uid()) then
    raise exception 'You do not have access to this plan''s chat.';
  end if;

  select occasion_type, who_for_name, title into v_occ_type, v_occ_who, v_occ_title
  from public._occasion_context_for_business_request(v_primary_id);

  return jsonb_build_object(
    'planId', v_plan.id,
    'title', coalesce(v_occ_title, v_plan.title),
    'occasionType', v_occ_type,
    'whoForName', v_occ_who
  )
    || jsonb_build_object('participants', public.get_plan_participants(v_plan.id) -> 'participants');
end;
$$;

revoke all on function public.get_plan_chat_info(uuid) from public, anon;
grant execute on function public.get_plan_chat_info(uuid) to authenticated;

-- ---- invite_to_business_request: reveal real occasion context in the
-- invite push, instead of the generic "invited you to their {category}
-- plan." Unchanged signature -- plain CREATE OR REPLACE is safe. Falls
-- back to the exact previous generic text (byte-identical) whenever the
-- request has no linked occasion at all.

create or replace function public.invite_to_business_request(request_id_param uuid, invitee_ids_param uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  v_excluded_friend_id uuid;
  v_primary_id uuid;
  v_occ_type text;
  v_occ_who text;
  v_push_title text;
  v_push_body text;
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

  v_excluded_friend_id := public._surprise_excluded_friend_id_for_business_request(v_request.id);
  v_primary_id := coalesce(v_request.parent_request_id, v_request.id);
  select occasion_type, who_for_name into v_occ_type, v_occ_who
  from public._occasion_context_for_business_request(v_primary_id);

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
    -- Item 96: never re-invite the person this plan is a surprise for,
    -- even after it's become a real business_requests-backed plan.
    continue when v_excluded_friend_id is not null and v_invitee_id = v_excluded_friend_id;

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
      if v_occ_type is not null then
        v_push_title := _occasion_emoji(v_occ_type) || ' You''re invited to help plan';
        v_push_body := coalesce(v_initiator_name, 'Someone you know') || ' invited you to help plan '
          || case when v_occ_who is not null then v_occ_who || '''s ' else 'their ' end
          || lower(_occasion_noun(v_occ_type)) || '.';
      else
        v_push_title := 'You''re invited to a plan';
        v_push_body := coalesce(v_initiator_name, 'Someone you know') || ' invited you to their ' || v_request.category || ' plan.';
      end if;

      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', v_invitee_id,
          'title', v_push_title,
          'body', v_push_body,
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
$function$;

revoke all on function public.invite_to_business_request(uuid, uuid[]) from public, anon;
grant execute on function public.invite_to_business_request(uuid, uuid[]) to authenticated;

-- ---- add_plan_organizer: reveal real occasion context in the
-- co-organizer push, instead of the generic plan title (which, for a
-- business-request-destined plan, is privacy-scrubbed business-facing
-- text). Unchanged signature -- plain CREATE OR REPLACE is safe.

create or replace function public.add_plan_organizer(business_request_id_param uuid, friend_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_primary_id uuid;
  v_plan record;
  v_host_name text;
  v_wants_notif boolean;
  service_key text;
  v_occ_type text;
  v_occ_who text;
  v_push_title text;
  v_push_body text;
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
  if friend_user_id = public._surprise_excluded_friend_id_for_business_request(business_request_id_param) then
    raise exception 'This plan is a surprise for that person -- they can''t be added yet.';
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
  select occasion_type, who_for_name into v_occ_type, v_occ_who
  from public._occasion_context_for_business_request(v_primary_id);

  if service_key is not null and v_wants_notif then
    if v_occ_type is not null then
      v_push_title := _occasion_emoji(v_occ_type) || ' You''re a co-organizer';
      v_push_body := coalesce(v_host_name, 'Someone you know') || ' added you as a co-organizer to help plan '
        || case when v_occ_who is not null then v_occ_who || '''s ' else 'their ' end
        || lower(_occasion_noun(v_occ_type)) || '.';
    else
      v_push_title := 'You''re a co-organizer';
      v_push_body := coalesce(v_host_name, 'Someone you know') || ' added you as a co-organizer for ' || coalesce(v_plan.title, 'a plan') || '.';
    end if;

    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', friend_user_id,
        'title', v_push_title,
        'body', v_push_body,
        'data', jsonb_build_object('type', 'plan_organizer_added', 'request_id', v_primary_id)
      )
    );
  end if;

  return jsonb_build_object('planId', v_plan.id, 'addedUserId', friend_user_id);
end;
$function$;

revoke all on function public.add_plan_organizer(uuid, uuid) from public, anon;
grant execute on function public.add_plan_organizer(uuid, uuid) to authenticated;
