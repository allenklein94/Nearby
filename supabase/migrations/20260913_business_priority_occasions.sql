-- Phase 2 of the "intelligent demand inbox" plan (see CLAUDE.md, Sep 3 2026 section) --
-- business occasion-appetite preferences ("what would you like more customers for").
--
-- A new, real, separate business preference -- brand_partners.priority_occasions text[],
-- reusing the exact same real curated vocabulary Phase 1's business_requests.occasion column
-- already established (birthday | anniversary | date_night | celebration | casual_hangout |
-- business_meal | family_gathering | other) -- no second taxonomy invented. Same UI/schema
-- convention as the existing priority_attributes/priority_time_windows columns/RPCs
-- (20260903_business_dna_goals_pulse.sql, 20260903_v3_business_accommodate_and_timing.sql):
-- a real, small, dedicated SECURITY DEFINER RPC, owner-only, real vocabulary check, no other
-- side effects -- meant to be revisited often, not part of a full identity-edit form.

alter table public.brand_partners
  add column if not exists priority_occasions text[] not null default '{}';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'brand_partners_priority_occasions_check'
  ) then
    alter table public.brand_partners
      add constraint brand_partners_priority_occasions_check
      check (priority_occasions <@ array[
        'birthday', 'anniversary', 'date_night', 'celebration',
        'casual_hangout', 'business_meal', 'family_gathering', 'other'
      ]::text[]);
  end if;
end $$;

create or replace function public.set_business_priority_occasions(
  partner_id_param uuid,
  occasions_param text[]
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

  if not (occasions_param <@ array[
    'birthday', 'anniversary', 'date_night', 'celebration',
    'casual_hangout', 'business_meal', 'family_gathering', 'other'
  ]::text[]) then
    raise exception 'Invalid occasion';
  end if;

  update brand_partners
  set priority_occasions = occasions_param
  where id = partner_id_param;
end;
$$;

revoke all on function public.set_business_priority_occasions(uuid, text[]) from public, anon;
grant execute on function public.set_business_priority_occasions(uuid, text[]) to authenticated;
