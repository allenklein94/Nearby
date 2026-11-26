-- Business phone + website the owner can see and change (owner, 2026-11-15).
-- Until now both were collected only on the application (business_partner_requests.phone / website, for admin review) and
-- never reached the business: brand_partners has no such columns and approval never copied them, so an owner could not
-- see or update them after approval.
--
-- PRIVATE by design: they never go on brand_partners, which every client reads with select('*') (Discover, profiles,
-- typed asks). They live in private.business_contact_details (no client grant, not exposed by the API), read and written
-- only through two definer functions:
--   * get_business_contact_details(partner)  -> the business's own managers and admins only
--   * set_business_contact_details(partner, phone, website) -> the business's own managers only (not suspended)
-- Never shown to customers, on offers, in discovery or in any customer-facing function (none reads this table).
--
-- Normalisation (the server is the authority; utils/businessContactDetails.js mirrors it for the form):
--   phone   = spaces, dashes, dots and brackets removed, an optional leading +, then 7-15 digits. No country is guessed.
--   website = trimmed, https:// added when no scheme was typed, http/https only, a host with a dot, no spaces, no
--             user:password@, scheme + host lowercased, at most 200 characters.
--   empty / null = cleared.
-- Approval carries the application's values (invalid ones are dropped, approval never fails because of them); existing
-- businesses are backfilled only from exactly ONE approved application that created them.
-- Builds <= 87 never read or write any of this (new table + new functions only): no compatibility gate.

create table private.business_contact_details (
  partner_id uuid primary key references public.brand_partners(id) on delete cascade,
  phone text,
  website text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint business_contact_phone_shape check (phone is null or phone ~ '^\+?[0-9]{7,15}$'),
  constraint business_contact_website_shape check (website is null or (website ~ '^https?://[a-z0-9.-]+\.[a-z0-9-]+([/?#][^[:space:]]*)?$' and length(website) <= 200))
);
revoke all on private.business_contact_details from public, anon, authenticated;
grant all on private.business_contact_details to service_role;

-- NULL = empty or not a phone number.
create or replace function private.normalize_business_phone(p text)
returns text
language sql
immutable
as $function$
  select case when v ~ '^\+?[0-9]{7,15}$' then v end
  from (select regexp_replace(btrim(coalesce(p, '')), '[[:space:]().-]', '', 'g') as v) s;
$function$;
revoke all on function private.normalize_business_phone(text) from public, anon, authenticated;

-- NULL = empty or not a usable web address.
create or replace function private.normalize_business_website(p text)
returns text
language plpgsql
immutable
as $function$
declare
  v text := btrim(coalesce(p, ''));
  m text[];
begin
  if v = '' or v ~ '[[:space:]]' then return null; end if;
  if v !~* '^[a-z][a-z0-9+.-]*://' then v := 'https://' || v; end if;
  m := regexp_match(v, '^([A-Za-z][A-Za-z0-9+.-]*)://([^/?#]*)(.*)$');
  if m is null or lower(m[1]) not in ('http', 'https') or m[2] like '%@%' then return null; end if;
  v := lower(m[1]) || '://' || lower(m[2]) || m[3];
  if length(v) > 200 or v !~ '^https?://[a-z0-9.-]+\.[a-z0-9-]+([/?#][^[:space:]]*)?$' or lower(m[2]) ~ '(^[.-]|[.-]$|\.\.)' then
    return null;
  end if;
  return v;
end;
$function$;
revoke all on function private.normalize_business_website(text) from public, anon, authenticated;

create or replace function public.get_business_contact_details(partner_id_param uuid)
returns table (phone text, website text, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null
     or not (exists (select 1 from profiles p where p.id = auth.uid() and p.managed_partner_id = partner_id_param)
             or check_is_admin(auth.uid())) then
    raise exception 'You do not manage this business' using errcode = '42501', hint = 'not_business_manager';
  end if;
  return query select c.phone, c.website, c.updated_at from private.business_contact_details c where c.partner_id = partner_id_param;
end;
$function$;
revoke all on function public.get_business_contact_details(uuid) from public, anon;
grant execute on function public.get_business_contact_details(uuid) to authenticated, service_role;

create or replace function public.set_business_contact_details(partner_id_param uuid, phone_param text, website_param text)
returns table (phone text, website text, updated_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_phone text := private.normalize_business_phone(phone_param);
  v_site text := private.normalize_business_website(website_param);
begin
  if auth.uid() is null or not exists (select 1 from profiles p where p.id = auth.uid() and p.managed_partner_id = partner_id_param) then
    raise exception 'You do not manage this business' using errcode = '42501', hint = 'not_business_manager';
  end if;
  if private.account_suspended(auth.uid()) then
    raise exception 'This account is suspended' using errcode = '42501', hint = 'account_suspended';
  end if;
  if btrim(coalesce(phone_param, '')) <> '' and v_phone is null then
    raise exception 'That doesn''t look like a phone number' using errcode = '22023', hint = 'invalid_phone';
  end if;
  if btrim(coalesce(website_param, '')) <> '' and v_site is null then
    raise exception 'That doesn''t look like a website address' using errcode = '22023', hint = 'invalid_website';
  end if;
  insert into private.business_contact_details as c (partner_id, phone, website, updated_at, updated_by)
  values (partner_id_param, v_phone, v_site, now(), auth.uid())
  on conflict (partner_id) do update set phone = excluded.phone, website = excluded.website, updated_at = now(), updated_by = auth.uid();
  return query select c.phone, c.website, c.updated_at from private.business_contact_details c where c.partner_id = partner_id_param;
end;
$function$;
revoke all on function public.set_business_contact_details(uuid, text, text) from public, anon;
grant execute on function public.set_business_contact_details(uuid, text, text) to authenticated, service_role;

-- Approval (approve_business_partner_request, unchanged) creates the business and sets resulting_partner_id in the same
-- UPDATE that sets status = 'approved'; this copies the application's phone + website at that moment. Invalid values are
-- left out; an existing row (never expected) is kept.
create or replace function public._carry_contact_details_on_approval()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_phone text := private.normalize_business_phone(new.phone);
  v_site text := private.normalize_business_website(new.website);
begin
  if new.status = 'approved' and old.status is distinct from 'approved' and new.resulting_partner_id is not null
     and (v_phone is not null or v_site is not null) then
    insert into private.business_contact_details (partner_id, phone, website, updated_by)
    values (new.resulting_partner_id, v_phone, v_site, new.requester_id)
    on conflict (partner_id) do nothing;
  end if;
  return new;
end;
$function$;
revoke all on function public._carry_contact_details_on_approval() from public, anon, authenticated;

drop trigger if exists bpr_carry_contact_details_on_approval on public.business_partner_requests;
create trigger bpr_carry_contact_details_on_approval
  after update of status on public.business_partner_requests
  for each row execute function public._carry_contact_details_on_approval();

-- Backfill: only a business created by exactly ONE approved application, and only values that pass normalisation.
insert into private.business_contact_details (partner_id, phone, website, updated_by)
select r.resulting_partner_id, private.normalize_business_phone(r.phone), private.normalize_business_website(r.website), r.requester_id
from public.business_partner_requests r
join public.brand_partners b on b.id = r.resulting_partner_id
where r.status = 'approved'
  and (select count(*) from public.business_partner_requests r2 where r2.status = 'approved' and r2.resulting_partner_id = r.resulting_partner_id) = 1
  and (private.normalize_business_phone(r.phone) is not null or private.normalize_business_website(r.website) is not null)
on conflict (partner_id) do nothing;
