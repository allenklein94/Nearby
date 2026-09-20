-- Share an experience ("Your night") with other people, VIEW-ONLY. Owner decisions (2026-09-20):
--   * viewer only: a shared person can see the night, its stops and each stop's state; they cannot request, cancel, reorder,
--     remove or change anything. The owner stays the only actor (all write RPCs stay `created_by = auth.uid()`).
--   * two ways to share: (1) a person the owner is ALREADY connected to (accepted friendship or match, never blocked) --
--     they get a push and it lists under Plans as "Night out (shared)"; (2) an owner-made, revocable, expiring guest link
--     for someone not on Nearby (named by the owner, one unguessable token per guest, view-only, this one night only).
--   * no stranger discovery, no public sharing, no organizer role. Architecture stays open for a later organizer role.
--
-- Viewers do NOT go through _can_view_plan / get_plan_overview: _can_view_plan also grants a parent's viewers access to its
-- CHILD request plans (offers, prices, reservations), which a shared night must not expose. Shared viewers read one narrow,
-- purpose-built projection instead (_night_stops_json): component, stop title/subtitle, state -- never request/offer/partner
-- ids, prices, party size or who else the night is shared with. A gathering stop's title is shown only when that gathering is
-- itself public; otherwise it reads "A gathering" (its host did not agree to have a private gathering shown to guests).

create table if not exists public.plan_shares (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  guest_name text,
  guest_token uuid unique,
  added_by uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  -- exactly one kind: a Nearby person OR a named guest link
  check ((user_id is not null) <> (guest_name is not null)),
  check (guest_name is null or (char_length(guest_name) between 1 and 40 and guest_token is not null))
);
create unique index if not exists plan_shares_plan_user_uniq on public.plan_shares(plan_id, user_id) where user_id is not null;
create index if not exists plan_shares_plan_idx on public.plan_shares(plan_id);
create index if not exists plan_shares_user_idx on public.plan_shares(user_id) where user_id is not null;
alter table public.plan_shares enable row level security;
revoke all on public.plan_shares from public, anon, authenticated;
-- No direct table access: every read/write goes through the RPCs below.

-- Already connected = accepted friendship or a match, and neither has blocked the other. Never used to find people.
create or replace function public._are_connected(a uuid, b uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select a is not null and b is not null and a <> b
    and (exists (select 1 from friendships f where f.status = 'accepted' and ((f.user_a = a and f.user_b = b) or (f.user_a = b and f.user_b = a)))
         or exists (select 1 from matches m where (m.user_a = a and m.user_b = b) or (m.user_a = b and m.user_b = a)))
    and not exists (select 1 from blocks bl where (bl.blocker_id = a and bl.blocked_id = b) or (bl.blocker_id = b and bl.blocked_id = a));
$$;
revoke all on function public._are_connected(uuid, uuid) from public, anon, authenticated;

-- The narrow, shared read of a night's stops (see header). The gathering state is the OWNER's attendance, not the reader's.
create or replace function public._night_stops_json(plan_id_param uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'order', s.sort_order,
      'componentLabel', s.component_label,
      'stopType', s.stop_type,
      'title', case when s.stop_type = 'gathering'
                    then coalesce((select g.title from gatherings g where g.id = s.ref_id and g.is_public is true and g.visibility = 'everyone'), 'A gathering')
                    else s.title end,
      'subtitle', case when s.stop_type = 'gathering'
                       then (select s.subtitle from gatherings g where g.id = s.ref_id and g.is_public is true and g.visibility = 'everyone')
                       else s.subtitle end,
      'state', case
        when s.stop_type = 'gathering' then
          case when exists (select 1 from gathering_interest gi join plans pl on pl.id = s.plan_id
                             where gi.gathering_id = s.ref_id and gi.user_id = pl.created_by and gi.status = 'approved')
               then 'booked' else 'chosen' end
        when s.request_id is null then 'chosen'
        else coalesce((
          select case c.status
                   when 'cancelled' then 'cancelled'
                   when 'completed' then 'done'
                   when 'confirmed' then 'booked'
                   else case when exists (select 1 from business_request_offers o where o.request_id = s.request_id and o.status = 'offered')
                             then 'offer_received' else 'requested' end
                 end
          from plans c where c.parent_plan_id = s.plan_id and c.resulting_business_request_id = s.request_id limit 1
        ), 'requested')
      end) order by s.sort_order), '[]'::jsonb)
  from plan_stops s where s.plan_id = plan_id_param;
$$;
revoke all on function public._night_stops_json(uuid) from public, anon, authenticated;

-- ---- Owner: share with a connected person ----
create or replace function public.share_experience_with_friend(plan_id_param uuid, friend_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_plan plans%rowtype;
  v_new uuid;
  v_name text;
  v_wants boolean;
  service_key text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  select * into v_plan from plans where id = plan_id_param and created_by = v_uid and plan_type = 'experience' for update;
  if not found then raise exception 'Not your experience'; end if;
  if v_plan.status not in ('draft', 'confirmed') then raise exception 'This night has ended and can no longer be shared.'; end if;
  if friend_id_param is null or friend_id_param = v_uid then raise exception 'Choose a friend to share with.'; end if;
  if not public._are_connected(v_uid, friend_id_param) then
    raise exception 'You can only share a night with a friend or a match.';
  end if;
  if (select count(*) from plan_shares where plan_id = plan_id_param and user_id is not null) >= 10 then
    raise exception 'You have shared this night with the maximum number of people.';
  end if;

  insert into plan_shares (plan_id, user_id, added_by) values (plan_id_param, friend_id_param, v_uid)
  on conflict do nothing returning id into v_new;
  if v_new is null then return jsonb_build_object('shared', true, 'alreadyShared', true); end if;

  select display_name into v_name from profiles where id = v_uid;
  select coalesce(notify_planning, true) into v_wants from profiles where id = friend_id_param;
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_wants and service_key is not null then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', friend_id_param,
        'title', '✨ ' || coalesce(v_name, 'A friend') || ' shared a night with you',
        'body', 'Tap to see the plan.',
        'data', jsonb_build_object('type', 'experience_shared', 'plan_id', plan_id_param)
      )
    );
  end if;
  return jsonb_build_object('shared', true, 'alreadyShared', false);
end;
$function$;

-- ---- Owner: a named, expiring, revocable guest link (view-only) ----
create or replace function public.create_experience_guest_link(plan_id_param uuid, guest_name_param text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_plan plans%rowtype;
  v_name text := nullif(trim(coalesce(guest_name_param, '')), '');
  v_token uuid := gen_random_uuid();
  v_id uuid;
  v_expires timestamptz := now() + interval '30 days';
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  select * into v_plan from plans where id = plan_id_param and created_by = v_uid and plan_type = 'experience' for update;
  if not found then raise exception 'Not your experience'; end if;
  if v_plan.status not in ('draft', 'confirmed') then raise exception 'This night has ended and can no longer be shared.'; end if;
  if v_name is null then raise exception 'Add the guest''s name so you know who the link is for.'; end if;
  if char_length(v_name) > 40 then raise exception 'That name is too long.'; end if;
  if (select count(*) from plan_shares where plan_id = plan_id_param and guest_name is not null and (expires_at is null or expires_at > now())) >= 10 then
    raise exception 'This night already has the maximum number of guest links. Remove one first.';
  end if;

  insert into plan_shares (plan_id, guest_name, guest_token, added_by, expires_at)
  values (plan_id_param, v_name, v_token, v_uid, v_expires) returning id into v_id;
  return jsonb_build_object('shareId', v_id, 'guestToken', v_token, 'guestName', v_name, 'expiresAt', v_expires);
end;
$function$;

-- ---- Owner: stop sharing with one person / kill one guest link. Idempotent. ----
create or replace function public.revoke_experience_share(share_id_param uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_deleted int;
begin
  delete from plan_shares s using plans p
   where s.id = share_id_param and p.id = s.plan_id and p.created_by = auth.uid();
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$function$;

-- ---- Viewer: leave a night shared with me. Idempotent. ----
create or replace function public.leave_shared_experience(plan_id_param uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_deleted int;
begin
  delete from plan_shares where plan_id = plan_id_param and user_id = auth.uid();
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$function$;

-- ---- Owner: who has this night (guest tokens are only ever returned here, to the owner) ----
create or replace function public.get_experience_shares(plan_id_param uuid)
returns table (id uuid, kind text, user_id uuid, display_name text, guest_name text, guest_token uuid, expires_at timestamptz, created_at timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $$
  select s.id, case when s.user_id is not null then 'friend' else 'guest' end, s.user_id, pr.display_name, s.guest_name, s.guest_token,
         s.expires_at, s.created_at
  from plan_shares s
  join plans p on p.id = s.plan_id and p.created_by = auth.uid() and p.plan_type = 'experience'
  left join profiles pr on pr.id = s.user_id
  where s.plan_id = plan_id_param
  order by s.created_at;
$$;

-- ---- Viewer (signed in): the shared night, read-only. Access also ends if the connection does. ----
create or replace function public.get_shared_night(plan_id_param uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_plan plans%rowtype;
begin
  if v_uid is null then return null; end if;
  select p.* into v_plan from plans p
   where p.id = plan_id_param and p.plan_type = 'experience'
     and exists (select 1 from plan_shares s where s.plan_id = p.id and s.user_id = v_uid)
     and public._are_connected(p.created_by, v_uid);
  if not found then return null; end if;
  return jsonb_build_object(
    'planId', v_plan.id,
    'title', v_plan.title,
    'status', v_plan.status,
    'hostDisplayName', (select display_name from profiles where id = v_plan.created_by),
    'stops', public._night_stops_json(v_plan.id)
  );
end;
$function$;

create or replace function public.get_shared_experience_plans()
returns table (id uuid, title text, status text, host_display_name text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select p.id, p.title, p.status, h.display_name
  from plan_shares s
  join plans p on p.id = s.plan_id and p.plan_type = 'experience' and p.status <> 'cancelled'
  join profiles h on h.id = p.created_by
  where s.user_id = auth.uid() and public._are_connected(p.created_by, auth.uid())
  order by s.created_at desc;
$$;

-- ---- Guest (anonymous, by token): the same narrow projection, plus only the guest's own name. Expired/revoked = null. ----
create or replace function public.get_public_shared_night(token_param uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_result jsonb;
begin
  select jsonb_build_object(
    'title', p.title,
    'status', p.status,
    'hostDisplayName', h.display_name,
    'guestName', s.guest_name,
    'expiresAt', s.expires_at,
    'stops', public._night_stops_json(p.id))
  into v_result
  from plan_shares s
  join plans p on p.id = s.plan_id and p.plan_type = 'experience'
  join profiles h on h.id = p.created_by
  where s.guest_token = token_param and s.user_id is null and (s.expires_at is null or s.expires_at > now());
  return v_result;
end;
$function$;

revoke all on function public.share_experience_with_friend(uuid, uuid) from public, anon;
revoke all on function public.create_experience_guest_link(uuid, text) from public, anon;
revoke all on function public.revoke_experience_share(uuid) from public, anon;
revoke all on function public.leave_shared_experience(uuid) from public, anon;
revoke all on function public.get_experience_shares(uuid) from public, anon;
revoke all on function public.get_shared_night(uuid) from public, anon;
revoke all on function public.get_shared_experience_plans() from public, anon;
revoke all on function public.get_public_shared_night(uuid) from public;
grant execute on function public.share_experience_with_friend(uuid, uuid) to authenticated;
grant execute on function public.create_experience_guest_link(uuid, text) to authenticated;
grant execute on function public.revoke_experience_share(uuid) to authenticated;
grant execute on function public.leave_shared_experience(uuid) to authenticated;
grant execute on function public.get_experience_shares(uuid) to authenticated;
grant execute on function public.get_shared_night(uuid) to authenticated;
grant execute on function public.get_shared_experience_plans() to authenticated;
grant execute on function public.get_public_shared_night(uuid) to anon, authenticated;
