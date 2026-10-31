-- Offer safety (owner approved 2026-10-31, gaps 1-3). Staged after 20270371; deploy only with its own approval.
-- Depends on 20270355 (reports.content_type / content_id + the server copy of reported content) and 20270370 (report
-- reason codes; its trigger runs first). No existing rows change: production holds 0 offers, 0 availability postings,
-- 0 occasion packages, 0 perks, 0 business updates and 0 screening rows (read-only check, 2026-10-31).
--
-- 1. Screening is bound to the write. Before: every screened business write is done by the screen-business-content edge
--    function calling the write function AS THE USER (submit_business_offer, post_business_availability,
--    update_business_profile, create/update_business_experience), or inserting as the user (brand_offers perks,
--    business_updates), and the user could make the same call directly and skip screening. Occasion packages were never
--    screened at all, and they become automatic offers.
--    Now: each of those writes needs a screening result the edge function recorded for THIS user, THIS business and THIS
--    target type, risk 'low', from a submission (never a re-sweep), under 30 minutes old, not used before, whose snapshot
--    holds exactly the screened content being written (text + media, key by key; prices and times are not screened content
--    and are not bound). It is consumed by the write (single use). Otherwise: refused, hint 'screening_required', nothing
--    written. How:
--      - the seven write functions move to schema private unchanged (renamed *_unscreened, no client access) and a thin
--        public wrapper with the same name, arguments, defaults and result checks the binding, then calls them. Nothing in
--        the database calls them by name (checked on prod), so no internal path changes.
--      - profile / experience / package UPDATES need a screening result only when the screened text or media really
--        change (address, category, attribute and active toggles keep working without one, as today's app does).
--      - brand_offers + business_updates: a BEFORE INSERT trigger does the same check.
--      - Exempt: the server itself (no signed-in user and not an anon/authenticated request: the edge function's service
--        client, cron, migrations) and, for the two table triggers only, an admin (the content review queue's "approve"
--        writes held content directly).
--    Occasion packages get their own screening target 'package' (screen-business-content branch); a held package that an
--    admin approves is applied from its snapshot by a trigger on the review decision.
-- 2. No contact details in offers. ONE rule private.offer_contact_kind(text) -> 'url' | 'email' | 'phone' | null (links,
--    "www.", bare domains, email addresses, "(at)/[at]" and "name at gmail" forms, 10+ digit numbers with separators,
--    xxx-xxxx numbers, 7+ spelled-out digits). Enforced by triggers on every customer-facing offer text: replies
--    (business_request_offers: description, title, included items, redemption instructions), availability postings
--    (title, description), occasion packages (name, description, included items) and perks (title, description,
--    redemption instructions); hint 'offer_contact_info', nothing written. On UPDATE only when one of those fields changes.
--    The edge function pre-checks through the same rule (public.offer_contact_info_kind, service role only), so contact
--    details are refused before screening and never held for review.
-- 3. "Report this offer". reports.content_type 'business_offer': the server checks the reporter can see that offer (read as
--    the reporter, the offer's own visibility rules), keeps its own copy (business name, title, description, included
--    items, redemption instructions, when it was sent), and sets reported_id to the person who manages that business
--    (whatever the client sent). A business can't report its own offer. Evidence is frozen like every other report (0355).

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Screening binding
-- ---------------------------------------------------------------------------------------------------------------------

alter table public.business_content_screening_results add column if not exists consumed_at timestamptz;

alter table public.business_content_screening_results drop constraint if exists business_content_screening_results_target_type_check;
alter table public.business_content_screening_results add constraint business_content_screening_results_target_type_check
  check (target_type = any (array['business_profile', 'offer', 'experience', 'availability', 'update', 'offer_response',
                                  'creative', 'package']));

create index if not exists business_content_screening_unconsumed_idx
  on public.business_content_screening_results (partner_id, submitted_by, target_type, created_at)
  where consumed_at is null;

-- A snapshot value and a written value are the same content when equal as jsonb; null, JSON null and "" all mean "none".
create or replace function private._screening_value(v jsonb)
returns jsonb
language sql
immutable
as $function$
  select case when v is null or v = 'null'::jsonb or v = '""'::jsonb then 'null'::jsonb else v end;
$function$;

create or replace function private._screening_snapshot_matches(snapshot jsonb, want jsonb)
returns boolean
language sql
immutable
as $function$
  select not exists (
    select 1 from jsonb_each(want) w
     where private._screening_value(snapshot -> w.key) is distinct from private._screening_value(w.value));
$function$;

-- The server itself (edge service client, cron, migrations): no signed-in user and not an anon/authenticated request.
create or replace function private._is_server_write()
returns boolean
language sql
stable
as $function$
  select auth.uid() is null and coalesce(auth.role(), '') not in ('anon', 'authenticated');
$function$;

-- The binding. Finds and consumes the caller's matching screening result, or refuses. Returns the screening id (null for a
-- server write).
create or replace function private.require_business_screening(p_partner uuid, p_target text, p_target_id uuid, p_content jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  if private._is_server_write() then
    return null;
  end if;
  select r.id into v_id
    from business_content_screening_results r
   where r.partner_id = p_partner
     and r.target_type = p_target
     and r.submitted_by = auth.uid()
     and r.source = 'submission'
     and r.risk_tier = 'low'
     and r.review_outcome is null
     and r.consumed_at is null
     and r.created_at > now() - interval '30 minutes'
     and r.target_id is not distinct from p_target_id
     and private._screening_snapshot_matches(r.content_snapshot, p_content)
   order by r.created_at desc
   limit 1
   for update skip locked;
  if v_id is null then
    raise exception 'This needs to go through Nearby''s content check before it can be published.'
      using errcode = '42501', hint = 'screening_required';
  end if;
  update business_content_screening_results set consumed_at = now() where id = v_id;
  return v_id;
end;
$function$;

-- The screened content of each write, built from the write's own arguments exactly as the edge function snapshots it.
-- The journey harness builds its stand-in screening rows from these same functions.
create or replace function private.screening_content_offer_response(p_request uuid, p_description text, p_title text,
  p_items text[], p_redemption text, p_media_path text, p_media_type text, p_poster text, p_creative uuid)
returns jsonb
language sql
immutable
as $function$
  select jsonb_build_object('requestId', p_request, 'offerDescription', p_description, 'offerTitle', p_title,
    'includedItems', to_jsonb(coalesce(p_items, '{}'::text[])), 'redemptionInstructions', p_redemption,
    'mediaPath', p_media_path, 'mediaType', p_media_type, 'posterPath', p_poster, 'creativeId', p_creative);
$function$;

create or replace function private.screening_content_availability(p_title text, p_description text)
returns jsonb
language sql
immutable
as $function$
  select jsonb_build_object('title', p_title, 'description', p_description);
$function$;

create or replace function private.screening_content_profile(p_name text, p_description text, p_logo text, p_differentiator text)
returns jsonb
language sql
immutable
as $function$
  select jsonb_build_object('name', p_name, 'description', p_description, 'logoUrl', p_logo, 'differentiator', p_differentiator);
$function$;

create or replace function private.screening_content_experience(p_title text, p_description text, p_media_path text, p_media_type text)
returns jsonb
language sql
immutable
as $function$
  select jsonb_build_object('title', trim(p_title), 'description', nullif(trim(coalesce(p_description, '')), ''),
    'mediaPath', p_media_path, 'mediaType', p_media_type);
$function$;

-- Package items as the package functions store them: trimmed, blanks dropped, order kept.
create or replace function private._package_items(p_items text[])
returns text[]
language sql
immutable
as $function$
  select coalesce(array_agg(trim(i) order by o), '{}'::text[])
    from unnest(coalesce(p_items, '{}'::text[])) with ordinality as u(i, o)
   where length(trim(i)) > 0;
$function$;

create or replace function private.screening_content_package(p_name text, p_description text, p_items text[])
returns jsonb
language sql
immutable
as $function$
  select jsonb_build_object('name', trim(p_name), 'description', nullif(trim(coalesce(p_description, '')), ''),
    'includedItems', to_jsonb(private._package_items(p_items)));
$function$;

create or replace function private.screening_content_perk(p_title text, p_description text, p_redemption text)
returns jsonb
language sql
immutable
as $function$
  select jsonb_build_object('title', p_title, 'description', p_description, 'redemptionInstructions', p_redemption);
$function$;

create or replace function private.screening_content_update(p_title text, p_body text)
returns jsonb
language sql
immutable
as $function$
  select jsonb_build_object('title', p_title, 'body', p_body);
$function$;

-- The caller's own business (the write functions read it the same way).
create or replace function private._caller_partner()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select managed_partner_id from profiles where id = auth.uid();
$function$;

-- Move the seven write functions out of reach, unchanged.
alter function public.submit_business_offer(uuid, text, text, numeric, timestamptz, uuid, text, text, text, text[], boolean,
  numeric, text, text, uuid, timestamptz, time, time, timestamptz, smallint) set schema private;
alter function private.submit_business_offer(uuid, text, text, numeric, timestamptz, uuid, text, text, text, text[], boolean,
  numeric, text, text, uuid, timestamptz, time, time, timestamptz, smallint) rename to submit_business_offer_unscreened;

alter function public.post_business_availability(text, text, text, text, numeric, integer, timestamptz, timestamptz,
  double precision, text, text[], numeric) set schema private;
alter function private.post_business_availability(text, text, text, text, numeric, integer, timestamptz, timestamptz,
  double precision, text, text[], numeric) rename to post_business_availability_unscreened;

alter function public.update_business_profile(uuid, text, text, text, double precision, double precision, text, text, text[],
  text, text, text, text[]) set schema private;
alter function private.update_business_profile(uuid, text, text, text, double precision, double precision, text, text, text[],
  text, text, text, text[]) rename to update_business_profile_unscreened;

alter function public.create_business_experience(uuid, text, text, text, text[], text, text, boolean, text, text) set schema private;
alter function private.create_business_experience(uuid, text, text, text, text[], text, text, boolean, text, text)
  rename to create_business_experience_unscreened;

alter function public.update_business_experience(uuid, text, text, text, text[], text, text, boolean, text, text) set schema private;
alter function private.update_business_experience(uuid, text, text, text, text[], text, text, boolean, text, text)
  rename to update_business_experience_unscreened;

alter function public.create_occasion_package(text, text, text, text[], integer, numeric, smallint[]) set schema private;
alter function private.create_occasion_package(text, text, text, text[], integer, numeric, smallint[])
  rename to create_occasion_package_unscreened;

alter function public.update_occasion_package(uuid, text, text, text, text[], integer, numeric, smallint[]) set schema private;
alter function private.update_occasion_package(uuid, text, text, text, text[], integer, numeric, smallint[])
  rename to update_occasion_package_unscreened;

revoke all on function private.submit_business_offer_unscreened(uuid, text, text, numeric, timestamptz, uuid, text, text, text,
  text[], boolean, numeric, text, text, uuid, timestamptz, time, time, timestamptz, smallint) from public, anon, authenticated;
revoke all on function private.post_business_availability_unscreened(text, text, text, text, numeric, integer, timestamptz,
  timestamptz, double precision, text, text[], numeric) from public, anon, authenticated;
revoke all on function private.update_business_profile_unscreened(uuid, text, text, text, double precision, double precision,
  text, text, text[], text, text, text, text[]) from public, anon, authenticated;
revoke all on function private.create_business_experience_unscreened(uuid, text, text, text, text[], text, text, boolean, text,
  text) from public, anon, authenticated;
revoke all on function private.update_business_experience_unscreened(uuid, text, text, text, text[], text, text, boolean, text,
  text) from public, anon, authenticated;
revoke all on function private.create_occasion_package_unscreened(text, text, text, text[], integer, numeric, smallint[])
  from public, anon, authenticated;
revoke all on function private.update_occasion_package_unscreened(uuid, text, text, text, text[], integer, numeric, smallint[])
  from public, anon, authenticated;

create function public.submit_business_offer(request_id_param uuid, offer_type_param text, offer_description_param text,
  offer_price_param numeric default null::numeric, proposed_time_param timestamp with time zone default null::timestamp with time zone,
  experience_id_param uuid default null::uuid, media_path_param text default null::text, media_type_param text default null::text,
  offer_title_param text default null::text, included_items_param text[] default '{}'::text[],
  price_is_per_person_param boolean default false, discount_pct_param numeric default null::numeric,
  redemption_instructions_param text default null::text, media_poster_path_param text default null::text,
  creative_id_param uuid default null::uuid, valid_until_param timestamp with time zone default null::timestamp with time zone,
  available_from_param time without time zone default null::time without time zone,
  available_until_param time without time zone default null::time without time zone,
  proposed_time_alt_param timestamp with time zone default null::timestamp with time zone,
  proposed_party_size_alt_param smallint default null::smallint)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_partner uuid := private._caller_partner();
begin
  if v_partner is not null then
    perform private.require_business_screening(v_partner, 'offer_response', null,
      private.screening_content_offer_response(request_id_param, offer_description_param, offer_title_param,
        included_items_param, redemption_instructions_param, media_path_param, media_type_param, media_poster_path_param,
        creative_id_param));
  end if;
  return private.submit_business_offer_unscreened($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
    $17, $18, $19, $20);
end;
$function$;

create function public.post_business_availability(category_param text, title_param text, description_param text,
  offer_type_param text, price_param numeric, capacity_param integer, starts_at_param timestamp with time zone,
  ends_at_param timestamp with time zone, radius_miles_param double precision default 15,
  bundle_occasion_param text default null::text, bundle_components_param text[] default null::text[],
  discount_pct_param numeric default null::numeric)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_partner uuid := private._caller_partner();
begin
  if v_partner is not null then
    perform private.require_business_screening(v_partner, 'availability', null,
      private.screening_content_availability(title_param, description_param));
  end if;
  return private.post_business_availability_unscreened($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12);
end;
$function$;

create function public.update_business_profile(partner_id_param uuid, name_param text, description_param text,
  address_param text, latitude_param double precision, longitude_param double precision, logo_url_param text,
  category_param text default null::text, attributes_param text[] default null::text[], cuisine_param text default null::text,
  differentiator_param text default null::text, subcategory_param text default null::text,
  categories_param text[] default null::text[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  cur record;
begin
  if private._caller_partner() is not distinct from partner_id_param and partner_id_param is not null then
    select name, description, logo_url, differentiator into cur from brand_partners where id = partner_id_param;
    if found and (name_param is distinct from cur.name
                  or description_param is distinct from cur.description
                  or logo_url_param is distinct from cur.logo_url
                  or coalesce(differentiator_param, cur.differentiator) is distinct from cur.differentiator) then
      perform private.require_business_screening(partner_id_param, 'business_profile', null,
        private.screening_content_profile(name_param, description_param, logo_url_param, differentiator_param));
    end if;
  end if;
  perform private.update_business_profile_unscreened($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13);
end;
$function$;

create function public.create_business_experience(partner_id_param uuid, title_param text, description_param text default null::text,
  icon_param text default null::text, attributes_param text[] default '{}'::text[], price_level_param text default null::text,
  party_type_param text default null::text, ai_suggested_param boolean default false, media_path_param text default null::text,
  media_type_param text default null::text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if partner_id_param is not null and private._caller_partner() is not distinct from partner_id_param then
    perform private.require_business_screening(partner_id_param, 'experience', null,
      private.screening_content_experience(title_param, description_param, media_path_param, media_type_param));
  end if;
  return private.create_business_experience_unscreened($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);
end;
$function$;

create function public.update_business_experience(experience_id_param uuid, title_param text, description_param text default null::text,
  icon_param text default null::text, attributes_param text[] default '{}'::text[], price_level_param text default null::text,
  party_type_param text default null::text, active_param boolean default true, media_path_param text default null::text,
  media_type_param text default null::text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  cur record;
  v_content jsonb := private.screening_content_experience(title_param, description_param, media_path_param, media_type_param);
begin
  select partner_id, title, description, media_path, media_type into cur from business_experiences where id = experience_id_param;
  if found and cur.partner_id is not distinct from private._caller_partner()
     and ((v_content ->> 'title') is distinct from cur.title
          or (v_content ->> 'description') is distinct from cur.description
          or media_path_param is distinct from cur.media_path
          or media_type_param is distinct from cur.media_type) then
    perform private.require_business_screening(cur.partner_id, 'experience', experience_id_param, v_content);
  end if;
  perform private.update_business_experience_unscreened($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);
end;
$function$;

create function public.create_occasion_package(occasion_type_param text, name_param text, description_param text default null::text,
  included_items_param text[] default '{}'::text[], min_guests_param integer default null::integer,
  price_per_person_param numeric default null::numeric, available_days_param smallint[] default null::smallint[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_partner uuid := private._caller_partner();
begin
  if v_partner is not null then
    perform private.require_business_screening(v_partner, 'package', null,
      private.screening_content_package(name_param, description_param, included_items_param));
  end if;
  return private.create_occasion_package_unscreened($1, $2, $3, $4, $5, $6, $7);
end;
$function$;

create function public.update_occasion_package(package_id_param uuid, occasion_type_param text, name_param text,
  description_param text default null::text, included_items_param text[] default '{}'::text[],
  min_guests_param integer default null::integer, price_per_person_param numeric default null::numeric,
  available_days_param smallint[] default null::smallint[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  cur record;
  v_content jsonb := private.screening_content_package(name_param, description_param, included_items_param);
begin
  select partner_id, name, description, included_items into cur from business_occasion_packages where id = package_id_param;
  if found and cur.partner_id is not distinct from private._caller_partner()
     and ((v_content ->> 'name') is distinct from cur.name
          or (v_content ->> 'description') is distinct from cur.description
          or private._package_items(included_items_param) is distinct from coalesce(cur.included_items, '{}'::text[])) then
    perform private.require_business_screening(cur.partner_id, 'package', package_id_param, v_content);
  end if;
  return private.update_occasion_package_unscreened($1, $2, $3, $4, $5, $6, $7, $8);
end;
$function$;

-- Same grants the functions had (signed-in people + the server); update_business_profile no longer runs for signed-out
-- callers (it always refused them: it checks the caller's business).
revoke all on function public.submit_business_offer(uuid, text, text, numeric, timestamptz, uuid, text, text, text, text[], boolean,
  numeric, text, text, uuid, timestamptz, time, time, timestamptz, smallint) from public, anon;
revoke all on function public.post_business_availability(text, text, text, text, numeric, integer, timestamptz, timestamptz,
  double precision, text, text[], numeric) from public, anon;
revoke all on function public.update_business_profile(uuid, text, text, text, double precision, double precision, text, text,
  text[], text, text, text, text[]) from public, anon;
revoke all on function public.create_business_experience(uuid, text, text, text, text[], text, text, boolean, text, text) from public, anon;
revoke all on function public.update_business_experience(uuid, text, text, text, text[], text, text, boolean, text, text) from public, anon;
revoke all on function public.create_occasion_package(text, text, text, text[], integer, numeric, smallint[]) from public, anon;
revoke all on function public.update_occasion_package(uuid, text, text, text, text[], integer, numeric, smallint[]) from public, anon;
grant execute on function public.submit_business_offer(uuid, text, text, numeric, timestamptz, uuid, text, text, text, text[], boolean,
  numeric, text, text, uuid, timestamptz, time, time, timestamptz, smallint) to authenticated, service_role;
grant execute on function public.post_business_availability(text, text, text, text, numeric, integer, timestamptz, timestamptz,
  double precision, text, text[], numeric) to authenticated, service_role;
grant execute on function public.update_business_profile(uuid, text, text, text, double precision, double precision, text, text,
  text[], text, text, text, text[]) to authenticated, service_role;
grant execute on function public.create_business_experience(uuid, text, text, text, text[], text, text, boolean, text, text)
  to authenticated, service_role;
grant execute on function public.update_business_experience(uuid, text, text, text, text[], text, text, boolean, text, text)
  to authenticated, service_role;
grant execute on function public.create_occasion_package(text, text, text, text[], integer, numeric, smallint[]) to authenticated, service_role;
grant execute on function public.update_occasion_package(uuid, text, text, text, text[], integer, numeric, smallint[])
  to authenticated, service_role;

-- Perks and business updates are inserted by the user (RLS); the same binding as a trigger.
create or replace function private._brand_offer_requires_screening()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if private._is_server_write() or check_is_admin(auth.uid()) then
    return new;
  end if;
  perform private.require_business_screening(new.partner_id, 'offer', null,
    private.screening_content_perk(new.title, new.description, new.redemption_instructions));
  return new;
end;
$function$;

create or replace function private._business_update_requires_screening()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if private._is_server_write() or check_is_admin(auth.uid()) then
    return new;
  end if;
  perform private.require_business_screening(new.partner_id, 'update', null,
    private.screening_content_update(new.title, new.body));
  return new;
end;
$function$;

drop trigger if exists zz_requires_screening on public.brand_offers;
create trigger zz_requires_screening before insert on public.brand_offers
  for each row execute function private._brand_offer_requires_screening();
drop trigger if exists zz_requires_screening on public.business_updates;
create trigger zz_requires_screening before insert on public.business_updates
  for each row execute function private._business_update_requires_screening();

-- A held package an admin approves is applied from its snapshot (create, or the edit of that same package), as the
-- business that submitted it. The review queue's own function handles every other target type.
create or replace function private._apply_approved_package_screening()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s jsonb := new.content_snapshot;
  v_days smallint[];
begin
  if new.target_type <> 'package' or new.source <> 'submission' or new.review_outcome is distinct from 'approved'
     or old.review_outcome is not distinct from 'approved' then
    return new;
  end if;
  select array_agg(d::smallint) into v_days from jsonb_array_elements_text(coalesce(s -> 'availableDays', 'null'::jsonb)) as d
   where jsonb_typeof(s -> 'availableDays') = 'array';
  if new.target_id is null then
    insert into business_occasion_packages (partner_id, occasion_type, name, description, included_items, min_guests,
                                            price_per_person, available_days)
    values (new.partner_id, s ->> 'occasionType', s ->> 'name', s ->> 'description',
            array(select jsonb_array_elements_text(coalesce(s -> 'includedItems', '[]'::jsonb))),
            (s ->> 'minGuests')::integer, (s ->> 'pricePerPerson')::numeric, v_days);
  else
    update business_occasion_packages
       set occasion_type = s ->> 'occasionType', name = s ->> 'name', description = s ->> 'description',
           included_items = array(select jsonb_array_elements_text(coalesce(s -> 'includedItems', '[]'::jsonb))),
           min_guests = (s ->> 'minGuests')::integer, price_per_person = (s ->> 'pricePerPerson')::numeric,
           available_days = v_days, updated_at = now()
     where id = new.target_id and partner_id = new.partner_id;
  end if;
  new.consumed_at := coalesce(new.consumed_at, now());
  return new;
end;
$function$;

drop trigger if exists apply_approved_package on public.business_content_screening_results;
create trigger apply_approved_package before update of review_outcome on public.business_content_screening_results
  for each row execute function private._apply_approved_package_screening();

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. No contact details in offer text
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function private.offer_contact_kind(t text)
returns text
language plpgsql
immutable
as $function$
declare
  s text;
begin
  if t is null or btrim(t) = '' then
    return null;
  end if;
  s := lower(t);
  -- links: a scheme, "www.", a bare domain, or a spelled-out dot before a common ending
  if s ~ 'https?:/' or s ~ '\mwww\s*(\.|\(dot\)|\[dot\])'
     or s ~ '\m[a-z0-9][a-z0-9-]+\.(com|net|org|io|co|biz|info|app|site|online|store|shop|link|ly)\M'
     or s ~ '\m[a-z0-9][a-z0-9-]+\s*(\(dot\)|\[dot\]|\{dot\}|\s+dot\s+)\s*(com|net|org|io|co|biz|info|app|site|online|store|shop|link|ly)\M' then
    return 'url';
  end if;
  -- email: an address, "(at)" forms, or "name at gmail"
  if s ~ '[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+'
     or s ~ '[a-z0-9._-]+\s*(\(at\)|\[at\]|\{at\})\s*[a-z0-9-]+'
     or s ~ '\m[a-z0-9._-]+\s+at\s+(gmail|yahoo|hotmail|outlook|icloud|aol|proton|protonmail|live|msn)\M' then
    return 'email';
  end if;
  -- phone: 10+ digits with only spaces . - ( ) between them, a xxx-xxxx number, or 7+ digits spelled out
  if s ~ '(\+?\d[\s().-]{0,3}){9,}\d'
     or s ~ '(^|[^\d:/$.,])\d{3}[\s.-]\d{4}($|[^\d:/%])'
     or s ~ '((zero|oh|one|two|three|four|five|six|seven|eight|nine)[\s,.-]*){7,}' then
    return 'phone';
  end if;
  return null;
end;
$function$;

-- The first kind found across several fields (null = none).
create or replace function private.offer_contact_kind_any(texts text[])
returns text
language sql
immutable
as $function$
  select private.offer_contact_kind(x) from unnest(coalesce(texts, '{}'::text[])) as x
   where private.offer_contact_kind(x) is not null limit 1;
$function$;

-- The edge function's pre-check (server only).
create or replace function public.offer_contact_info_kind(texts_param text[])
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select private.offer_contact_kind_any(texts_param);
$function$;
revoke all on function public.offer_contact_info_kind(text[]) from public, anon, authenticated;
grant execute on function public.offer_contact_info_kind(text[]) to service_role;

create or replace function private._refuse_offer_contact(texts text[])
returns void
language plpgsql
immutable
as $function$
begin
  if private.offer_contact_kind_any(texts) is not null then
    raise exception 'Offers can''t include website links, email addresses or phone numbers. Customers reach you through Nearby.'
      using errcode = '22023', hint = 'offer_contact_info';
  end if;
end;
$function$;

create or replace function private._offer_contact_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_new text[];
  v_old text[];
begin
  if tg_table_name = 'business_request_offers' then
    v_new := array[new.offer_description, new.offer_title, new.redemption_instructions] || coalesce(new.included_items, '{}'::text[]);
    if tg_op = 'UPDATE' then
      v_old := array[old.offer_description, old.offer_title, old.redemption_instructions] || coalesce(old.included_items, '{}'::text[]);
    end if;
  elsif tg_table_name = 'business_availability' then
    v_new := array[new.title, new.description];
    if tg_op = 'UPDATE' then v_old := array[old.title, old.description]; end if;
  elsif tg_table_name = 'business_occasion_packages' then
    v_new := array[new.name, new.description] || coalesce(new.included_items, '{}'::text[]);
    if tg_op = 'UPDATE' then v_old := array[old.name, old.description] || coalesce(old.included_items, '{}'::text[]); end if;
  elsif tg_table_name = 'brand_offers' then
    v_new := array[new.title, new.description, new.redemption_instructions];
    if tg_op = 'UPDATE' then v_old := array[old.title, old.description, old.redemption_instructions]; end if;
  end if;
  if tg_op = 'UPDATE' and v_new is not distinct from v_old then
    return new;
  end if;
  perform private._refuse_offer_contact(v_new);
  return new;
end;
$function$;

drop trigger if exists offer_contact_guard on public.business_request_offers;
create trigger offer_contact_guard before insert or update on public.business_request_offers
  for each row execute function private._offer_contact_guard();
drop trigger if exists offer_contact_guard on public.business_availability;
create trigger offer_contact_guard before insert or update on public.business_availability
  for each row execute function private._offer_contact_guard();
drop trigger if exists offer_contact_guard on public.business_occasion_packages;
create trigger offer_contact_guard before insert or update on public.business_occasion_packages
  for each row execute function private._offer_contact_guard();
drop trigger if exists offer_contact_guard on public.brand_offers;
create trigger offer_contact_guard before insert or update on public.brand_offers
  for each row execute function private._offer_contact_guard();

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. "Report this offer"
-- ---------------------------------------------------------------------------------------------------------------------

alter table public.reports drop constraint if exists reports_content_type_check;
alter table public.reports add constraint reports_content_type_check check (
  content_type is null
  or content_type in ('message', 'gathering_message', 'community_message', 'plan_message', 'business_message', 'match_chat',
                      'business_offer'));

-- 20270355's function with one more branch (business_offer); every other branch unchanged.
create or replace function public._capture_report_content()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_sender uuid;
  v_body text;
  v_at timestamptz;
  v_partner uuid;
begin
  new.content_excerpt := null;
  new.content_sent_at := null;
  new.content_captured_at := null;
  if new.content_type is null then
    return new;
  end if;

  if new.content_type = 'business_offer' then
    -- read as the reporter: only an offer they can see (their own request, their group plan, match or gathering)
    select o.partner_id,
           concat_ws(E'\n',
             nullif(btrim(o.offer_title), ''),
             nullif(btrim(o.offer_description), ''),
             case when coalesce(array_length(o.included_items, 1), 0) > 0
                  then 'Included: ' || array_to_string(o.included_items, ', ') end,
             case when nullif(btrim(o.redemption_instructions), '') is not null
                  then 'Redemption: ' || btrim(o.redemption_instructions) end),
           coalesce(o.responded_at, o.created_at)
      into v_partner, v_body, v_at
      from business_request_offers o
     where o.id = new.content_id and o.offer_description is not null;
    if v_partner is null then
      raise exception 'That offer isn''t available' using errcode = '22023', hint = 'report_content_mismatch';
    end if;
    -- who answers for it (its manager) + its name are set next by _capture_report_business_offer (server side)
    new.content_excerpt := left(coalesce(v_body, ''), 1800);
    new.content_sent_at := v_at;
    new.content_captured_at := now();
    return new;
  end if;

  if new.content_type = 'match_chat' then
    if not exists (select 1 from matches m
                    where m.id = new.content_id
                      and ((m.user_a = new.reporter_id and m.user_b = new.reported_id)
                        or (m.user_b = new.reporter_id and m.user_a = new.reported_id))) then
      raise exception 'That chat isn''t with this person' using errcode = '22023', hint = 'report_content_mismatch';
    end if;
    select left(string_agg(to_char(x.created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC: '
                           || coalesce(nullif(btrim(x.body), ''), '[' || coalesce(x.media_type, 'media') || ']'),
                           E'\n' order by x.created_at), 4000),
           max(x.created_at)
      into v_body, v_at
      from (select mm.body, mm.media_type, mm.created_at from messages mm
             where mm.match_id = new.content_id and mm.sender_id = new.reported_id
             order by mm.created_at desc limit 20) x;
    new.content_excerpt := v_body;
    new.content_sent_at := v_at;
    new.content_captured_at := now();
    return new;
  end if;

  if new.content_type = 'message' then
    select m.sender_id, coalesce(nullif(btrim(m.body), ''), '[' || coalesce(m.media_type, 'media') || ']'), m.created_at
      into v_sender, v_body, v_at from messages m where m.id = new.content_id;
  elsif new.content_type = 'gathering_message' then
    select m.sender_id, coalesce(nullif(btrim(m.body), ''), '[media]'), m.created_at
      into v_sender, v_body, v_at from gathering_messages m where m.id = new.content_id;
  elsif new.content_type = 'community_message' then
    select m.sender_id, coalesce(nullif(btrim(m.body), ''), '[media]'), m.created_at
      into v_sender, v_body, v_at from community_messages m where m.id = new.content_id;
  elsif new.content_type = 'plan_message' then
    select m.sender_id, m.body, m.created_at
      into v_sender, v_body, v_at from plan_messages m where m.id = new.content_id;
  elsif new.content_type = 'business_message' then
    select m.sender_id, m.body, m.created_at
      into v_sender, v_body, v_at from business_messages m where m.id = new.content_id;
  end if;

  -- not visible to the reporter, gone, or written by someone else: refused, never attached to the wrong person
  if v_sender is null or v_sender is distinct from new.reported_id then
    raise exception 'That message isn''t from this person' using errcode = '22023', hint = 'report_content_mismatch';
  end if;
  new.content_excerpt := left(v_body, 2000);
  new.content_sent_at := v_at;
  new.content_captured_at := now();
  return new;
end;
$function$;
revoke all on function public._capture_report_content() from public, anon, authenticated;

-- Runs right after _capture_report_content (trigger names sort: capture_report_content < capture_report_content_offer),
-- which has already proved, as the reporter, that they can see the offer (content_captured_at is set only then; a client
-- can't set it). Server side: the report is about the person who manages that business (whatever the client sent), and
-- the copy names the business. A business can't report its own offer.
create or replace function private._capture_report_business_offer()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_partner uuid;
  v_manager uuid;
  v_name text;
begin
  if new.content_type is distinct from 'business_offer' then
    return new;
  end if;
  if new.content_captured_at is null then
    raise exception 'That offer isn''t available' using errcode = '22023', hint = 'report_content_mismatch';
  end if;
  select o.partner_id into v_partner from business_request_offers o where o.id = new.content_id;
  select p.id into v_manager from profiles p where p.managed_partner_id = v_partner order by p.created_at limit 1;
  select bp.name into v_name from brand_partners bp where bp.id = v_partner;
  if new.reporter_id is not null and exists (select 1 from profiles p where p.id = new.reporter_id and p.managed_partner_id = v_partner) then
    raise exception 'You can''t report your own business''s offer' using errcode = '22023', hint = 'report_content_mismatch';
  end if;
  new.reported_id := v_manager;
  new.content_excerpt := left('Offer from ' || coalesce(v_name, 'a business') || E':\n' || coalesce(new.content_excerpt, ''), 2000);
  return new;
end;
$function$;

drop trigger if exists capture_report_content_offer on public.reports;
create trigger capture_report_content_offer before insert on public.reports
  for each row execute function private._capture_report_business_offer();

-- Server-only helpers: no client access.
revoke all on function private._screening_value(jsonb) from public, anon, authenticated;
revoke all on function private._screening_snapshot_matches(jsonb, jsonb) from public, anon, authenticated;
revoke all on function private._is_server_write() from public, anon, authenticated;
revoke all on function private.require_business_screening(uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function private.screening_content_offer_response(uuid, text, text, text[], text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function private.screening_content_availability(text, text) from public, anon, authenticated;
revoke all on function private.screening_content_profile(text, text, text, text) from public, anon, authenticated;
revoke all on function private.screening_content_experience(text, text, text, text) from public, anon, authenticated;
revoke all on function private._package_items(text[]) from public, anon, authenticated;
revoke all on function private.screening_content_package(text, text, text[]) from public, anon, authenticated;
revoke all on function private.screening_content_perk(text, text, text) from public, anon, authenticated;
revoke all on function private.screening_content_update(text, text) from public, anon, authenticated;
revoke all on function private._caller_partner() from public, anon, authenticated;
revoke all on function private._brand_offer_requires_screening() from public, anon, authenticated;
revoke all on function private._business_update_requires_screening() from public, anon, authenticated;
revoke all on function private._apply_approved_package_screening() from public, anon, authenticated;
revoke all on function private.offer_contact_kind(text) from public, anon, authenticated;
revoke all on function private.offer_contact_kind_any(text[]) from public, anon, authenticated;
revoke all on function private._refuse_offer_contact(text[]) from public, anon, authenticated;
revoke all on function private._offer_contact_guard() from public, anon, authenticated;
revoke all on function private._capture_report_business_offer() from public, anon, authenticated;
