-- gatherings/communities' owner-scoped UPDATE RLS ("Hosts can update their own
-- gatherings" / "Creator can update or delete their community") has no
-- column-level restriction, so a host/creator could already silently set their
-- own hosting_partner_id to any real brand_partners id with zero consent from
-- that business -- confirmed live: as a real host, updating hosting_partner_id
-- on a real gathering to a real, unrelated business succeeded outright. Same
-- shape as the other guarded-column fixes elsewhere in this schema
-- (prevent_self_premium_edit on profiles). Fixed here with an analogous
-- BEFORE UPDATE trigger on both tables, since this migration is about to make
-- hosting_partner_id load-bearing for a real approval flow -- it needs to
-- only ever be set by the creation-time auto-link trigger (unaffected, that's
-- BEFORE INSERT) or by the new respond_to_business_partnership_request RPC
-- below (which sets app.trusted_update first), never by a plain client write.
create or replace function public.prevent_hosting_partner_self_edit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is not null and coalesce(current_setting('app.trusted_update', true), '') <> 'true' then
    if new.hosting_partner_id is distinct from old.hosting_partner_id then
      new.hosting_partner_id := old.hosting_partner_id;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists on_gathering_updated_protect_partner on public.gatherings;
create trigger on_gathering_updated_protect_partner
  before update on public.gatherings
  for each row execute function public.prevent_hosting_partner_self_edit();

drop trigger if exists on_community_updated_protect_partner on public.communities;
create trigger on_community_updated_protect_partner
  before update on public.communities
  for each row execute function public.prevent_hosting_partner_self_edit();

-- A gathering/community host wanting a real, named business to be officially
-- tied to their specific event -- distinct from business_partner_requests,
-- which is a generic "onboard my business as an app-wide partner"
-- application with no link to any specific gathering/community at all.
-- Polymorphic target shape matches the existing social_invites convention:
-- one table, since gathering/community request shapes are identical.
create table public.business_partnership_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('gathering', 'community')),
  target_id uuid not null,
  partner_id uuid not null references public.brand_partners(id) on delete cascade,
  message text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create unique index business_partnership_requests_pending_unique
  on public.business_partnership_requests (target_type, target_id, partner_id)
  where (status = 'pending');

create index business_partnership_requests_partner_idx
  on public.business_partnership_requests (partner_id, status);

alter table public.business_partnership_requests enable row level security;

create policy "Requester or target business owner can view requests"
  on public.business_partnership_requests for select
  using (
    requester_id = auth.uid()
    or exists (select 1 from public.profiles where id = auth.uid() and managed_partner_id = business_partnership_requests.partner_id)
  );

-- No direct client INSERT/UPDATE policy -- both go through the SECURITY
-- DEFINER RPCs below, matching this codebase's established convention of
-- never letting the client write a sensitive row directly.

create or replace function public.request_business_partnership(target_type_param text, target_id_param uuid, partner_id_param uuid, message_param text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_request_id uuid;
  v_owns_target boolean;
begin
  if target_type_param not in ('gathering', 'community') then
    raise exception 'Invalid target type';
  end if;

  if target_type_param = 'gathering' then
    select exists(select 1 from gatherings where id = target_id_param and host_id = auth.uid()) into v_owns_target;
  else
    select exists(select 1 from community_members where community_id = target_id_param and user_id = auth.uid() and role in ('creator', 'leader')) into v_owns_target;
  end if;

  if not v_owns_target then
    raise exception 'You can only request a business partner for a gathering you host or a community you lead';
  end if;

  if not exists (select 1 from brand_partners where id = partner_id_param and active = true) then
    raise exception 'That business could not be found';
  end if;

  insert into business_partnership_requests (requester_id, target_type, target_id, partner_id, message)
  values (auth.uid(), target_type_param, target_id_param, partner_id_param, nullif(trim(coalesce(message_param, '')), ''))
  on conflict (target_type, target_id, partner_id) where status = 'pending' do nothing
  returning id into v_request_id;

  if v_request_id is null then
    raise exception 'A request for this business is already pending';
  end if;

  return v_request_id;
end;
$function$;

revoke all on function public.request_business_partnership(text, uuid, uuid, text) from public, anon;
grant execute on function public.request_business_partnership(text, uuid, uuid, text) to authenticated;

create or replace function public.respond_to_business_partnership_request(request_id_param uuid, approve boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_request record;
  service_key text;
  v_business_name text;
  v_target_title text;
begin
  select * into v_request from business_partnership_requests where id = request_id_param;
  if v_request is null then
    raise exception 'Request not found';
  end if;

  if not exists (select 1 from profiles where id = auth.uid() and managed_partner_id = v_request.partner_id) then
    raise exception 'Only the target business owner can respond to this request';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'This request has already been reviewed';
  end if;

  update business_partnership_requests
  set status = case when approve then 'approved' else 'declined' end, reviewed_at = now()
  where id = request_id_param;

  if approve then
    perform set_config('app.trusted_update', 'true', true);
    if v_request.target_type = 'gathering' then
      update gatherings set hosting_partner_id = v_request.partner_id where id = v_request.target_id;
    else
      update communities set hosting_partner_id = v_request.partner_id where id = v_request.target_id;
    end if;
  end if;

  select name into v_business_name from brand_partners where id = v_request.partner_id;
  if v_request.target_type = 'gathering' then
    select title into v_target_title from gatherings where id = v_request.target_id;
  else
    select name into v_target_title from communities where id = v_request.target_id;
  end if;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  perform net.http_post(
    url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
    body := jsonb_build_object(
      'recipient_id', v_request.requester_id,
      'title', case when approve then coalesce(v_business_name, 'A business') || ' accepted your partnership request' else coalesce(v_business_name, 'A business') || ' declined your partnership request' end,
      'body', coalesce(v_target_title, 'Your gathering'),
      'data', jsonb_build_object('type', 'business_partnership_response', 'target_type', v_request.target_type, 'target_id', v_request.target_id)
    )
  );
end;
$function$;

revoke all on function public.respond_to_business_partnership_request(uuid, boolean) from public, anon;
grant execute on function public.respond_to_business_partnership_request(uuid, boolean) to authenticated;
