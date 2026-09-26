-- Owner item 86 (2026-09-26): a business can say what it does NOT accommodate, and matching removes a KNOWN conflict before it is
-- ever shown or routed. One new owner-declared list, `brand_partners.not_accommodated` (closed vocabulary: no_children, no_pets,
-- adults_21_plus); the rest of the owner's list already exists as its own declaration and is reused, never duplicated:
--   No large groups        = max_group_size (item 80)
--   Reservations required  = booking_mode reservation_required / request_required (item 72)
--   No walk-ins            = the same booking mode
--   Indoor only / Outdoor only = weather_setting indoor / outdoor (item 63)
-- 21+ here is the business's own house rule, used ONLY to keep requests that involve children away; Nearby never checks anyone's
-- age and it gates nothing (age limits on gatherings stay parked, item 39/79).
--
-- Elimination is by conflict only: the business declared the restriction AND the request's own structured fields conflict with it.
-- Unknown on either side = no effect. A request addressed to ONE business by the customer (_route_request_to_partner) is not
-- touched: the person chose that business.

alter table public.brand_partners add column if not exists not_accommodated text[] not null default '{}';
alter table public.brand_partners drop constraint if exists brand_partners_not_accommodated_check;
alter table public.brand_partners add constraint brand_partners_not_accommodated_check
  check (not_accommodated <@ array['no_children', 'no_pets', 'adults_21_plus']::text[]);

-- A business cannot say both "no children" and "Family-friendly" (or "no pets" and "Pet friendly"). Checked on every write path
-- (profile editor, Teach Nearby, apply approval, the setter below) with a message that says what to change. Service animals are
-- not pets: service_animal_friendly never conflicts.
create or replace function public._check_business_not_accommodated()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if coalesce(new.not_accommodated, '{}') && array['no_children', 'adults_21_plus'] then
    if coalesce(new.attributes, '{}') && array['kid_friendly', 'kid_menu', 'family_seating', 'stroller_friendly'] then
      raise exception 'You said you don''t accommodate children, so Family-friendly, Kids menu, Family seating and Stroller friendly can''t be on too. Remove one of them first.';
    end if;
    if new.suited_age_min is not null or new.suited_age_max is not null then
      raise exception 'You said you don''t accommodate children, so clear the suited ages first.';
    end if;
  end if;
  if 'no_pets' = any(coalesce(new.not_accommodated, '{}'))
     and coalesce(new.attributes, '{}') && array['dog_friendly', 'pet_friendly'] then
    raise exception 'You said you don''t allow pets, so Dog friendly and Pet friendly can''t be on too. Remove one of them first.';
  end if;
  return new;
end;
$$;
revoke all on function public._check_business_not_accommodated() from public, anon, authenticated;
drop trigger if exists check_business_not_accommodated on public.brand_partners;
create trigger check_business_not_accommodated
  before insert or update of not_accommodated, attributes, suited_age_min, suited_age_max on public.brand_partners
  for each row execute function public._check_business_not_accommodated();

create or replace function public.set_business_not_accommodated(partner_id_param uuid, keys_param text[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_keys text[];
begin
  if auth.uid() is null or not exists (select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param) then
    raise exception 'Only the business owner can change this.';
  end if;
  v_keys := array(select distinct k from unnest(coalesce(keys_param, '{}')) k where k is not null order by k);
  if not (v_keys <@ array['no_children', 'no_pets', 'adults_21_plus']::text[]) then
    raise exception 'Pick from No children, No pets or 21+ only.';
  end if;
  update brand_partners set not_accommodated = v_keys where id = partner_id_param;
end;
$$;
revoke all on function public.set_business_not_accommodated(uuid, text[]) from public, anon;
grant execute on function public.set_business_not_accommodated(uuid, text[]) to authenticated;

-- The ONE conflict rule for routing and auto-offers. True = this business declared something the request's own fields conflict with.
--   party_size above the declared largest group
--   children in the request (kid attributes) at a no_children / 21+ business
--   pets in the request (dog_friendly / pet_friendly) at a no_pets business
--   outdoor seating asked for at a business that declared indoor only
create or replace function public._business_declines_request(partner_id_param uuid, request_id_param uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((
    select
      (r.party_size is not null and p.max_group_size is not null and p.max_group_size < r.party_size)
      or (coalesce(r.attributes, '{}') && array['kid_friendly', 'kid_menu', 'family_seating', 'stroller_friendly']
          and coalesce(p.not_accommodated, '{}') && array['no_children', 'adults_21_plus'])
      or (coalesce(r.attributes, '{}') && array['dog_friendly', 'pet_friendly'] and 'no_pets' = any(coalesce(p.not_accommodated, '{}')))
      or ('outdoor_seating' = any(coalesce(r.attributes, '{}')) and p.weather_setting = 'indoor')
    from brand_partners p, business_requests r
    where p.id = partner_id_param and r.id = request_id_param
  ), false);
$$;
revoke all on function public._business_declines_request(uuid, uuid) from public, anon, authenticated;

-- Routing and the three auto-offer matchers read it (patched from the live bodies; guarded to fail loudly).
do $mig$
declare v_def text; v_new text;
begin
  -- 1. fan-out: eligible businesses exclude a declared conflict (item 80's "largest group below the party goes last" becomes a removal)
  v_def := pg_get_functiondef('public._business_request_fanout(uuid, double precision, double precision, double precision, text[], text)'::regprocedure);
  v_new := replace(v_def, $q$      and (v_req_group is null or public.business_in_category_group(p.id, v_req_group))
$q$, $q$      and (v_req_group is null or public.business_in_category_group(p.id, v_req_group))
      -- item 86: a business that declared something this request conflicts with is never routed it
      and not public._business_declines_request(p.id, request_id_param)
$q$);
  if v_new = v_def then raise exception '_business_request_fanout patch did not apply'; end if;
  execute v_new;

  v_def := pg_get_functiondef('public._match_request_to_availability(uuid, double precision, double precision, double precision, text, date, time without time zone, time without time zone, uuid, integer)'::regprocedure);
  v_new := replace(v_def, $q$join brand_partners p on p.id = ba.partner_id and p.active = true$q$,
    $q$join brand_partners p on p.id = ba.partner_id and p.active = true and not public._business_declines_request(p.id, request_id_param)$q$);
  if (length(v_new) - length(v_def)) < 3 * 50 then raise exception '_match_request_to_availability patch did not apply'; end if;
  execute v_new;

  v_def := pg_get_functiondef('public._match_request_to_package(uuid, double precision, double precision, double precision, text, integer, date, uuid)'::regprocedure);
  v_new := replace(v_def, $q$join brand_partners p on p.id = bop.partner_id and p.active = true$q$,
    $q$join brand_partners p on p.id = bop.partner_id and p.active = true and not public._business_declines_request(p.id, request_id_param)$q$);
  if (length(v_new) - length(v_def)) < 2 * 50 then raise exception '_match_request_to_package patch did not apply'; end if;
  execute v_new;

  v_def := pg_get_functiondef('public._match_request_to_policy(uuid, double precision, double precision, double precision, integer, time without time zone, time without time zone)'::regprocedure);
  v_new := replace(v_def, $q$join brand_partners p on p.id = bfp.partner_id and p.active = true$q$,
    $q$join brand_partners p on p.id = bfp.partner_id and p.active = true and not public._business_declines_request(p.id, request_id_param)$q$);
  if (length(v_new) - length(v_def)) < 2 * 50 then raise exception '_match_request_to_policy patch did not apply'; end if;
  execute v_new;
end
$mig$;
