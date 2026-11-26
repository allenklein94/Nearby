-- Admins remove a reported gathering or community from the moderation queue (owner, 2026-11-06: approved exception to the freeze,
-- the last piece of the reporting work). Staged after 20270392; own deploy approval. Needs 20270355, 20270373, 20270391, 20270392.
--
-- 1. Removal DELETES the live row, the way a host's cancel already does. It does not use moderation_state: 74 SECURITY DEFINER
--    functions read gatherings without the visibility rule and 21 tables hang off the two objects, so a hidden row would stay
--    reachable through every one of them that was missed (a meet-up point, a join, a reminder). A deleted row closes all of them at
--    once for attendees, members, the host, direct links and invite links, and the app already handles a gathering that has gone.
-- 2. Evidence stays: public.reports (its copy, 20270355 + 20270392) and any held photo (20270391) never depended on the row. The
--    removal adds private.content_removals: who, when, why, which report, plus a snapshot of the object and who was in it, 12 months
--    (the same period as a resolved report; the who/when/why stays after that). The chat is deleted with the object, as on a host's
--    cancel: only messages someone reported are kept (their own copy). The gathering's point is never copied (locked rule).
-- 3. Reported, open, gathering or community reports only; a written reason (10-1000 characters); admins only, checked here; never
--    your own object (hint own_content). The report stays open: the admin resolves it, as with Remove Photo. Cannot be undone.
-- 4. A repeating gathering: every occurrence goes, past and upcoming, because the generator copies the text from the latest one and
--    would bring it back. A generator run already under way can't re-create one: it shares a per-series lock with this function and
--    its insert is dropped once the series is on record (the trigger below).
-- 5. A gathering's memory photos are deleted with it: stories.gathering_id is ON DELETE SET NULL, and a Story with no gathering falls
--    under the ordinary Story rule, so they would otherwise reach the poster's friends. A reported one stays held (20270391).
-- 6. Bookings: as on a cancel, but only for gatherings still to come (a past visit is history). Worded without the title. A paid
--    booking can't be cancelled from here: both sides are told, as on a cancel.
-- 7. Copies of the title on other rows: plans (title, place label), pending invitations, partnership requests, pending held text.
--    A perk gated on the object stops: with its gate gone it would otherwise be refused by a check, or open to everyone.
-- 8. Attendees are told "removed by Nearby", never "cancelled by the host" (notify_gathering_cancelled reads the removal record), and
--    only for what is still to come; the owner is told once. Nobody is told who reported it or why. The title is in no push.
-- Not changed: a community's gatherings stay (their own objects, reportable on their own; ones visible only to the community
-- then show to nobody new), suspension, reports, caps. Removing bans nobody: the owner can post again, and Suspend stays separate.

create table private.content_removals (
  id uuid primary key default gen_random_uuid(),
  content_type text not null check (content_type in ('gathering', 'community')),
  content_id uuid not null,
  series_id uuid,
  owner_id uuid,
  report_id uuid not null,
  removed_by uuid not null,
  reason text not null check (length(reason) between 10 and 1000),
  snapshot jsonb,
  removed_at timestamptz not null default now()
);
create index content_removals_content_idx on private.content_removals (content_id);
create index content_removals_series_idx on private.content_removals (series_id) where series_id is not null;
revoke all on table private.content_removals from public, anon, authenticated;

-- Everything that isn't the row itself: bookings, open requests, invitations, partnership requests, held text.
create function private.content_removal_close_links(p_type text, p_id uuid, p_bookings boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_offer record;
  v_result jsonb;
  v_request record;
  v_what text := case p_type when 'gathering' then 'A gathering' else 'A community' end;
  m uuid;
begin
  if p_bookings then
    for v_offer in
      select o.id as offer_id, o.partner_id, o.request_id
        from business_request_offers o
        join business_requests r on r.id = o.request_id
       where o.status = 'accepted'
         and ((p_type = 'gathering' and r.gathering_id = p_id) or (p_type = 'community' and r.community_id = p_id))
    loop
      select * into v_request from business_requests where id = v_offer.request_id;
      v_result := _cancel_reservation_by_offer(v_offer.offer_id);
      if (v_result->>'cancelled')::boolean then
        perform public._send_push(v_request.requester_id, 'Your reservation was cancelled',
          v_what || ' linked to your reservation was removed by Nearby, so the reservation was cancelled too.',
          jsonb_build_object('type', 'business_reservation_cancelled', 'request_id', v_request.id, 'offer_id', v_offer.offer_id));
        for m in select id from profiles where managed_partner_id = v_offer.partner_id loop
          perform public._send_push(m, 'A reservation was cancelled',
            v_what || ' linked to a reservation was removed by Nearby, so the reservation was cancelled too.',
            jsonb_build_object('type', 'reservation_cancelled_by_customer', 'request_id', v_request.id, 'offer_id', v_offer.offer_id));
        end loop;
      elsif v_result->>'reason' = 'payment_captured' then
        perform public._send_push(v_request.requester_id, 'Action needed on your reservation',
          v_what || ' linked to your paid reservation was removed by Nearby. Contact the business directly to arrange a refund.',
          jsonb_build_object('type', 'business_reservation_cancelled', 'request_id', v_request.id, 'offer_id', v_offer.offer_id));
        for m in select id from profiles where managed_partner_id = v_offer.partner_id loop
          perform public._send_push(m, 'A paid reservation is affected',
            v_what || ' linked to a paid reservation was removed by Nearby. The customer may reach out about a refund.',
            jsonb_build_object('type', 'reservation_cancelled_by_customer', 'request_id', v_request.id, 'offer_id', v_offer.offer_id));
        end loop;
      end if;
    end loop;
  end if;

  update business_request_offers set status = 'cancelled'
   where status in ('pending', 'offered')
     and request_id in (select r.id from business_requests r
                         where (p_type = 'gathering' and r.gathering_id = p_id) or (p_type = 'community' and r.community_id = p_id));
  update business_requests set status = 'cancelled'
   where status = 'open' and ((p_type = 'gathering' and gathering_id = p_id) or (p_type = 'community' and community_id = p_id));

  -- A perk gated on this object stops, gate cleared with it: the check on brand_offers refuses a gated perk with the id gone, so
  -- the delete below would fail, and a perk left active with no gate would open to everyone.
  update brand_offers set active = false, unlock_scope = null, unlock_min_members = null, unlock_community_id = null
   where (p_type = 'community' and unlock_community_id = p_id)
      or (p_type = 'gathering' and gathering_id = p_id and unlock_scope = 'gathering');

  delete from social_invites where invite_type = p_type and target_id = p_id and status = 'pending';
  delete from business_partnership_requests where target_type = p_type and target_id = p_id;
  update private.ugc_held_items set status = 'superseded'
   where target_table = case p_type when 'gathering' then 'gatherings' else 'communities' end
     and target_id = p_id and status = 'pending';
end;
$function$;
revoke all on function private.content_removal_close_links(text, uuid, boolean) from public, anon, authenticated;

create function private.content_remove_gathering(g public.gatherings, p_report uuid, p_admin uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s record;
begin
  -- on record first: notify_gathering_cancelled reads it during the delete below
  insert into private.content_removals (content_type, content_id, series_id, owner_id, report_id, removed_by, reason, snapshot)
  values ('gathering', g.id, g.recurring_series_id, g.host_id, p_report, p_admin, p_reason, jsonb_build_object(
    'title', g.title, 'description', g.description, 'scheduled_at', g.scheduled_at, 'created_at', g.created_at,
    'interest_tag', g.interest_tag, 'visibility', g.visibility, 'women_only', g.women_only, 'community_id', g.community_id,
    'hosting_partner_id', g.hosting_partner_id, 'cover_photo_path', g.cover_photo_path, 'timeline_steps', g.timeline_steps,
    'attendees', (select coalesce(jsonb_agg(jsonb_build_object('user_id', gi.user_id, 'status', gi.status)), '[]'::jsonb)
                    from gathering_interest gi where gi.gathering_id = g.id)));

  for s in select id, gathering_id, user_id from stories where gathering_id = g.id for update loop
    delete from stories where id = s.id;
    insert into private.story_media_removals (story_id, gathering_id, poster_id, removed_by, removed_as, report_id, note)
    values (s.id, s.gathering_id, s.user_id, p_admin, 'admin', p_report, left(p_reason, 1000));
  end loop;

  perform private.content_removal_close_links('gathering', g.id, g.scheduled_at > now());
  update plans set status = 'cancelled', title = null, location_label = null where resulting_gathering_id = g.id;
  delete from gatherings where id = g.id;
end;
$function$;
revoke all on function private.content_remove_gathering(public.gatherings, uuid, uuid, text) from public, anon, authenticated;

create function private.content_remove_community(c public.communities, p_report uuid, p_admin uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  m uuid;
begin
  insert into private.content_removals (content_type, content_id, owner_id, report_id, removed_by, reason, snapshot)
  values ('community', c.id, c.creator_id, p_report, p_admin, p_reason, jsonb_build_object(
    'name', c.name, 'description', c.description, 'created_at', c.created_at, 'interest_tag', c.interest_tag,
    'is_public', c.is_public, 'status', c.status, 'hosting_partner_id', c.hosting_partner_id,
    'cover_photo_url', c.cover_photo_url,
    'members', (select coalesce(jsonb_agg(jsonb_build_object('user_id', cm.user_id, 'role', cm.role)), '[]'::jsonb)
                  from community_members cm where cm.community_id = c.id)));

  perform private.content_removal_close_links('community', c.id, true);
  for m in select cm.user_id from community_members cm where cm.community_id = c.id
            and cm.user_id is distinct from c.creator_id loop
    continue when not coalesce((select notify_community from profiles where id = m), true);
    perform public._send_push(m, 'A community was removed', 'A community you were in was removed by Nearby.',
      jsonb_build_object('type', 'community_cancelled'));
  end loop;
  delete from communities where id = c.id;
end;
$function$;
revoke all on function private.content_remove_community(public.communities, uuid, uuid, text) from public, anon, authenticated;

create function public.admin_remove_reported_content(report_id_param uuid, reason_param text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admin uuid := auth.uid();
  v_reason text := btrim(coalesce(reason_param, ''));
  v_report reports%rowtype;
  v_gathering gatherings%rowtype;
  v_community communities%rowtype;
  v_series uuid;
  v_owner uuid;
  v_removed integer := 0;
  g gatherings%rowtype;
begin
  if v_admin is null or not check_is_admin(v_admin) then
    raise exception 'Admins only' using errcode = '42501', hint = 'admin_only';
  end if;
  if length(v_reason) not between 10 and 1000 then
    raise exception 'Say why, in 10 to 1000 characters' using errcode = '22023', hint = 'removal_reason_required';
  end if;
  -- the report first: a resolve at the same moment goes one way or the other, never both
  select * into v_report from reports r where r.id = report_id_param for update;
  if not found then
    raise exception 'That report doesn''t exist' using errcode = 'P0002', hint = 'report_not_found';
  end if;
  if v_report.content_type is null or v_report.content_type not in ('gathering', 'community') then
    raise exception 'That report isn''t about a gathering or community' using errcode = '22023', hint = 'report_not_removable';
  end if;
  if coalesce(v_report.resolved, false) then
    raise exception 'That report is resolved. Reopen it first.' using errcode = '22023', hint = 'report_resolved';
  end if;

  if v_report.content_type = 'gathering' then
    select recurring_series_id, host_id into v_series, v_owner from gatherings where id = v_report.content_id;
    if v_series is not null then
      perform pg_advisory_xact_lock(hashtextextended('gathering_series:' || v_series::text, 0));
    end if;
    if v_owner = v_admin then
      raise exception 'You can''t remove your own' using errcode = '42501', hint = 'own_content';
    end if;
    -- FOR UPDATE: a join, a message or a report waits here, then finds nothing; one that got in first is in the snapshot
    for g in select * from gatherings x
              where x.id = v_report.content_id or (v_series is not null and x.recurring_series_id = v_series)
              order by x.id for update loop
      perform private.content_remove_gathering(g, v_report.id, v_admin, v_reason);
      v_removed := v_removed + 1;
    end loop;
    if v_removed > 0 and v_owner is not null then
      perform public._send_push(v_owner, 'Your gathering was removed', 'Nearby removed your gathering after a review.',
        jsonb_build_object('type', 'gathering_cancelled'));
    end if;
  else
    select * into v_community from communities c where c.id = v_report.content_id for update;
    if found then
      v_owner := v_community.creator_id;
      if v_owner = v_admin then
        raise exception 'You can''t remove your own' using errcode = '42501', hint = 'own_content';
      end if;
      perform private.content_remove_community(v_community, v_report.id, v_admin, v_reason);
      v_removed := 1;
      if v_owner is not null then
        perform public._send_push(v_owner, 'Your community was removed', 'Nearby removed your community after a review.',
          jsonb_build_object('type', 'community_cancelled'));
      end if;
    end if;
  end if;

  if v_removed = 0 then
    -- another admin got there first, or the owner already cancelled it: nothing left to remove and nothing to record
    return jsonb_build_object('removed', 0, 'already', true);
  end if;
  return jsonb_build_object('removed', v_removed, 'already', false);
end;
$function$;
revoke all on function public.admin_remove_reported_content(uuid, text) from public, anon;
grant execute on function public.admin_remove_reported_content(uuid, text) to authenticated;

-- What the queue shows: is the reported object still there, was it removed, by whom and why. Admins only.
create function public.admin_get_report_objects(report_ids_param uuid[])
returns table (report_id uuid, state text, removed_at timestamptz, removed_by_name text, reason text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null or not check_is_admin(auth.uid()) then
    raise exception 'Admins only' using errcode = '42501', hint = 'admin_only';
  end if;
  return query
    select r.id,
           case when cr.id is not null then 'removed'
                when (r.content_type = 'gathering' and exists (select 1 from gatherings g where g.id = r.content_id))
                  or (r.content_type = 'community' and exists (select 1 from communities c where c.id = r.content_id)) then 'live'
                else 'gone' end,
           cr.removed_at, p.display_name, cr.reason
      from reports r
      left join lateral (select x.* from private.content_removals x where x.content_id = r.content_id
                          order by x.removed_at desc limit 1) cr on true
      left join profiles p on p.id = cr.removed_by
     where r.id = any(report_ids_param) and r.content_type in ('gathering', 'community');
end;
$function$;
revoke all on function public.admin_get_report_objects(uuid[]) from public, anon;
grant execute on function public.admin_get_report_objects(uuid[]) to authenticated;

-- A removed series can't come back: generate_next_recurring_gathering copies from an occurrence it read before the removal.
-- Shares the lock the removal holds, so it either sees the record here or runs before the removal locks the series. Dropping the
-- row (not raising) lets the generator's other series carry on; its push loop then finds nobody, the attendees having gone with
-- the row.
create function private.refuse_removed_series()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform pg_advisory_xact_lock_shared(hashtextextended('gathering_series:' || new.recurring_series_id::text, 0));
  if exists (select 1 from private.content_removals r where r.series_id = new.recurring_series_id) then
    return null;
  end if;
  return new;
end;
$function$;
revoke all on function private.refuse_removed_series() from public, anon, authenticated;
create trigger aa_refuse_removed_series before insert on public.gatherings
  for each row when (new.recurring_series_id is not null) execute function private.refuse_removed_series();

-- 20270116's function + the removal branch: the words must be true, and the title of removed content goes nowhere.
create or replace function public.notify_gathering_cancelled()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  recipient record;
  v_removed boolean := exists (select 1 from private.content_removals r where r.content_id = old.id);
begin
  if v_removed and old.scheduled_at < now() then
    return old;  -- a past occurrence going with its series: nothing to tell anyone
  end if;

  for recipient in
    select user_id from gathering_interest where gathering_id = old.id and status = 'approved'
    union
    select gd.user_id from gathering_interested gd
     where gd.gathering_id = old.id
       and old.scheduled_at >= now()
       and not exists (select 1 from blocks b
                        where (b.blocker_id = old.host_id and b.blocked_id = gd.user_id)
                           or (b.blocker_id = gd.user_id and b.blocked_id = old.host_id))
  loop
    if coalesce((select notify_planning from profiles where id = recipient.user_id), true) then
      if not v_removed then
        perform public._send_push(recipient.user_id, 'A gathering was cancelled', '"' || old.title || '" has been cancelled by the host.', jsonb_build_object('type', 'gathering_cancelled'));
      elsif recipient.user_id is distinct from old.host_id then
        perform public._send_push(recipient.user_id, 'A gathering was removed', 'A gathering you were following was removed by Nearby.', jsonb_build_object('type', 'gathering_cancelled'));
      end if;
    end if;
  end loop;
  return old;
end;
$function$;

-- The snapshot goes after 12 months; who removed what, when and why stays.
create function private.purge_content_removal_snapshots()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update private.content_removals set snapshot = null
   where snapshot is not null and removed_at < now() - interval '12 months';
$function$;
revoke all on function private.purge_content_removal_snapshots() from public, anon, authenticated;
select cron.schedule('purge-content-removal-snapshots', '37 4 * * *', 'select private.purge_content_removal_snapshots();');
