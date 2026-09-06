-- Host cancellation lifecycle for Communities and Gatherings (agreed
-- 2026-09-06, CLAUDE.md "Active / unfinished work"). Communities gain a
-- real status column (active/paused/cancelled) because Pause is a
-- genuinely reversible persistent state with no other representation.
-- Gatherings deliberately do NOT gain a status column -- the existing
-- hard-delete + BEFORE DELETE trigger mechanism already correctly notifies
-- attendees; a soft-cancel column here would ripple into every gathering
-- list/feed/search/matches/recurring-series query (a much higher fan-out
-- entity than communities), which nothing asked for. cancel_gathering()
-- instead centralizes the ownership check and performs the same real
-- delete under the hood, so both existing triggers on gatherings keep
-- firing completely unchanged.

-- ============ 1. communities.status ============

alter table public.communities
  add column if not exists status text not null default 'active'
    check (status in ('active', 'paused', 'cancelled'));

-- Force every status transition through pause_community/resume_community/
-- cancel_community below, not a raw client UPDATE -- exact idiom as
-- prevent_hosting_partner_self_edit() (already live on this same table).
create or replace function public.prevent_community_status_self_edit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if coalesce(current_setting('app.trusted_update', true), '') <> 'true' then
    if new.status is distinct from old.status then
      new.status := old.status;
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function public.prevent_community_status_self_edit() from public, anon, authenticated;

drop trigger if exists on_community_updated_protect_status on public.communities;
create trigger on_community_updated_protect_status
  before update on public.communities
  for each row execute function public.prevent_community_status_self_edit();

-- Tighten the one RLS policy that actually needs it: non-member/non-creator
-- discovery only ever sees an active public community. Member/creator
-- branches unchanged -- they must keep seeing their own paused/cancelled
-- community.
drop policy if exists "Public communities visible to everyone, private only to members" on public.communities;
create policy "Public communities visible to everyone, private only to members"
  on public.communities
  as permissive
  for select
  to authenticated
  using (
    ((is_public = true) and (status = 'active'))
    or (creator_id = auth.uid())
    or (exists (select 1 from community_members cm where cm.community_id = communities.id and cm.user_id = auth.uid()))
  );

-- Bonus hardening found while auditing this table's RLS: the UPDATE policy
-- had no `with check`, so a creator's raw client update could already
-- rewrite creator_id itself (silent transfer/orphan). Same shape bug the
-- 20260816 identity-column RLS sweep already fixed for other tables.
drop policy if exists "Creator can update or delete their community" on public.communities;
create policy "Creator can update or delete their community"
  on public.communities
  for update
  to authenticated
  using (creator_id = auth.uid())
  with check (creator_id = auth.uid());

-- update_community(): editable fields (name/description/interest_tag/
-- is_public) via RPC, matching this table's existing established
-- convention -- authenticated has no raw UPDATE grant on communities at
-- all (verified live); every write, including the existing area-only
-- update_community_area(), already goes through a SECURITY DEFINER RPC.
-- Creator-only (unlike update_community_area, which also allows a
-- 'leader' member) to match Edit Community being a creator-only action
-- in the new Manage Community menu.
create or replace function public.update_community(
  community_id_param uuid,
  name_param text,
  description_param text,
  interest_tag_param text,
  is_public_param boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (select 1 from communities where id = community_id_param and creator_id = auth.uid()) then
    raise exception 'Only the community creator can edit this community.';
  end if;

  update communities
  set
    name = name_param,
    description = nullif(trim(description_param), ''),
    interest_tag = interest_tag_param,
    is_public = is_public_param
  where id = community_id_param;

  return jsonb_build_object('success', true);
end;
$function$;

revoke all on function public.update_community(uuid, text, text, text, boolean) from public, anon;
grant execute on function public.update_community(uuid, text, text, text, boolean) to authenticated;

-- ============ 2. pause_community / resume_community / cancel_community ============
-- Same shape as cancel_business_request() (20260814_business_fulfillment.sql):
-- select ... for update (ownership check + row lock combined), a status-
-- guard exception, then a trusted status-column transition.

create or replace function public.pause_community(community_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text;
begin
  select status into v_status from communities where id = community_id_param and creator_id = auth.uid() for update;
  if v_status is null then
    raise exception 'Community not found.';
  end if;
  if v_status <> 'active' then
    raise exception 'Only an active community can be paused.';
  end if;

  perform set_config('app.trusted_update', 'true', true);
  update communities set status = 'paused' where id = community_id_param;
  return jsonb_build_object('success', true);
end;
$function$;

revoke all on function public.pause_community(uuid) from public, anon;
grant execute on function public.pause_community(uuid) to authenticated;

create or replace function public.resume_community(community_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text;
begin
  select status into v_status from communities where id = community_id_param and creator_id = auth.uid() for update;
  if v_status is null then
    raise exception 'Community not found.';
  end if;
  if v_status <> 'paused' then
    raise exception 'Only a paused community can be resumed.';
  end if;

  perform set_config('app.trusted_update', 'true', true);
  update communities set status = 'active' where id = community_id_param;
  return jsonb_build_object('success', true);
end;
$function$;

revoke all on function public.resume_community(uuid) from public, anon;
grant execute on function public.resume_community(uuid) to authenticated;

-- cancel_community(): creator-only, terminal (cannot cancel an already-
-- cancelled community), notifies every real member (mirrors notify_
-- gathering_cancelled's exact net.http_post idiom -- vault service key,
-- loop a real recipient set, send-push body shape), and cascades to any
-- still-open business_requests/business_request_offers tied to this
-- community (mirrors cancel_business_request's own two-step cascade --
-- this cascade never existed for gatherings or communities before this
-- migration).
create or replace function public.cancel_community(community_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text;
  v_name text;
  service_key text;
  member_row record;
begin
  select status, name into v_status, v_name from communities where id = community_id_param and creator_id = auth.uid() for update;
  if v_status is null then
    raise exception 'Community not found.';
  end if;
  if v_status = 'cancelled' then
    raise exception 'This community is already cancelled.';
  end if;

  perform set_config('app.trusted_update', 'true', true);
  update communities set status = 'cancelled' where id = community_id_param;

  update business_requests set status = 'cancelled'
    where community_id = community_id_param and status = 'open';
  update business_request_offers set status = 'cancelled'
    where request_id in (select id from business_requests where community_id = community_id_param)
      and status in ('pending', 'offered');

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for member_row in
    select user_id from community_members where community_id = community_id_param and user_id <> auth.uid()
  loop
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', member_row.user_id,
        'title', 'A community was cancelled',
        'body', '"' || v_name || '" has been cancelled by its creator.',
        'data', jsonb_build_object('type', 'community_cancelled')
      )
    );
  end loop;

  return jsonb_build_object('success', true);
end;
$function$;

revoke all on function public.cancel_community(uuid) from public, anon;
grant execute on function public.cancel_community(uuid) to authenticated;

-- ============ 3. cancel_gathering() ============
-- Deliberately still a real DELETE (see header comment) -- both existing
-- BEFORE DELETE triggers (notify_gathering_cancelled, deactivate_offer_on_
-- gathering_delete) keep firing completely unchanged. This RPC's own job
-- is: centralize the ownership+existence+not-already-past guard (currently
-- done nowhere -- the client just calls .delete() against RLS), and add
-- the same business_requests/business_request_offers cascade cancel_
-- community gets above (previously absent for gatherings entirely; only
-- brand_offers were ever deactivated on gathering delete).
create or replace function public.cancel_gathering(gathering_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_scheduled_at timestamptz;
begin
  select scheduled_at into v_scheduled_at from gatherings where id = gathering_id_param and host_id = auth.uid() for update;
  if v_scheduled_at is null then
    raise exception 'Gathering not found.';
  end if;
  if v_scheduled_at < now() then
    raise exception 'This gathering has already happened and can no longer be cancelled.';
  end if;

  update business_requests set status = 'cancelled'
    where gathering_id = gathering_id_param and status = 'open';
  update business_request_offers set status = 'cancelled'
    where request_id in (select id from business_requests where gathering_id = gathering_id_param)
      and status in ('pending', 'offered');

  delete from gatherings where id = gathering_id_param;
  return jsonb_build_object('success', true);
end;
$function$;

revoke all on function public.cancel_gathering(uuid) from public, anon;
grant execute on function public.cancel_gathering(uuid) to authenticated;
