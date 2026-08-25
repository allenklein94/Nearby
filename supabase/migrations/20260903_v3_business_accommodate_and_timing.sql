-- "Business Profile Phase 1" addendum -- see CLAUDE.md for the full
-- context. Two real, small array columns on brand_partners, both reusing
-- an already-established vocabulary elsewhere in this schema rather than
-- inventing a new one:
--   - accommodates_party_types: the exact same 'solo'/'friends'/'groups'/
--     'date' vocabulary gatherings.party_type and business_experiences.
--     party_type already use.
--   - priority_time_windows: the exact same 'morning'/'afternoon'/
--     'evening'/'weekend' vocabulary utils/timeContext.js's getTimePeriod()
--     already establishes client-side (Home's own greeting/Quick Picks).
-- Both nullable-array-default-'{}' -- every existing row backfills to an
-- empty array, zero behavior change for anything that predates this pass.

alter table public.brand_partners
  add column if not exists accommodates_party_types text[] not null default '{}',
  add column if not exists priority_time_windows text[] not null default '{}';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'brand_partners_accommodates_party_types_check'
  ) then
    alter table brand_partners
      add constraint brand_partners_accommodates_party_types_check
      check (accommodates_party_types <@ array['solo', 'friends', 'groups', 'date']::text[]);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'brand_partners_priority_time_windows_check'
  ) then
    alter table brand_partners
      add constraint brand_partners_priority_time_windows_check
      check (priority_time_windows <@ array['morning', 'afternoon', 'evening', 'weekend']::text[]);
  end if;
end $$;

-- Two new, small, dedicated RPCs, mirroring set_business_priority_attributes()'s
-- exact shape (owner-only, real vocabulary check, no other side effects) --
-- both are "revisited often" quick-toggle preferences, not core identity
-- fields, matching that function's own established reasoning for why this
-- is a narrow RPC rather than folded into update_business_profile().

create or replace function public.set_business_accommodations(
  partner_id_param uuid,
  party_types_param text[]
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (
    select 1 from profiles
    where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    raise exception 'You do not manage this business';
  end if;

  if not (party_types_param <@ array['solo', 'friends', 'groups', 'date']::text[]) then
    raise exception 'Invalid party type';
  end if;

  update brand_partners
  set accommodates_party_types = party_types_param
  where id = partner_id_param;
end;
$$;

revoke all on function public.set_business_accommodations(uuid, text[]) from public, anon;
grant execute on function public.set_business_accommodations(uuid, text[]) to authenticated;

create or replace function public.set_business_priority_time_windows(
  partner_id_param uuid,
  time_windows_param text[]
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (
    select 1 from profiles
    where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    raise exception 'You do not manage this business';
  end if;

  if not (time_windows_param <@ array['morning', 'afternoon', 'evening', 'weekend']::text[]) then
    raise exception 'Invalid time window';
  end if;

  update brand_partners
  set priority_time_windows = time_windows_param
  where id = partner_id_param;
end;
$$;

revoke all on function public.set_business_priority_time_windows(uuid, text[]) from public, anon;
grant execute on function public.set_business_priority_time_windows(uuid, text[]) to authenticated;
