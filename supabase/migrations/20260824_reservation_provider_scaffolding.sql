-- Resy/OpenTable reservation-provider scaffolding (see CLAUDE.md, Aug 24
-- 2026 -- direct follow-up to the already-live Stripe Connect scaffolding
-- pass, same "build the seams now, they're cheap" discipline, but a real,
-- deliberate difference from that pass worth stating up front: Stripe has
-- a public, stable, well-documented REST API, which is what let that
-- earlier pass build a real outbound REST client against a known spec.
-- Resy and OpenTable do not have open self-serve developer APIs -- both
-- require applying for and being approved for a real partner API
-- relationship before their real endpoint/auth/payload shape is even
-- knowable. There is no real spec to build an outbound client against
-- yet, so this migration deliberately does not attempt one.
--
-- What this migration actually does: lets a business owner record which
-- external reservation system they use and their venue id in that system
-- -- real, genuinely useful groundwork, safe to capture today. What it
-- deliberately does NOT do: touch accept_business_offer() in any way.
-- That function still always creates an immediately-confirmed
-- provider='nearby' reservation, completely unchanged, regardless of what
-- gets set here -- branching real reservation confirmation on a provider
-- Nearby has no real way to actually call yet would strand a real
-- customer's reservation in 'requested' forever with no path to
-- 'confirmed'. Wiring this in for real needs, in order: (1) apply for and
-- get approved for Resy/OpenTable partner API access, (2) get their real
-- API docs/credentials, (3) build a real outbound integration against
-- their real spec, (4) only then re-point accept_business_offer() to
-- branch on reservation_provider.

alter table public.brand_partners
  add column if not exists reservation_provider text,
  add column if not exists reservation_provider_venue_id text,
  add column if not exists reservation_provider_connected_at timestamptz;

alter table public.brand_partners
  drop constraint if exists brand_partners_reservation_provider_check;
alter table public.brand_partners
  add constraint brand_partners_reservation_provider_check
  check (reservation_provider is null or reservation_provider in ('resy', 'opentable'));

-- Owner-only, same ownership-check shape as update_business_profile()/
-- upsert_business_fulfillment_policy() -- no direct client UPDATE on
-- brand_partners for these three columns.
create or replace function public.update_business_reservation_provider(
  partner_id_param uuid,
  provider_param text,
  venue_id_param text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from profiles
    where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    raise exception 'You do not manage this business.';
  end if;

  if provider_param is not null and provider_param not in ('resy', 'opentable') then
    raise exception 'Invalid reservation provider.';
  end if;

  update brand_partners
  set reservation_provider = provider_param,
      -- Clearing the provider also clears its venue id/connected-at --
      -- a stale venue id left behind after disconnecting would be a real,
      -- if minor, data-integrity gap.
      reservation_provider_venue_id = case when provider_param is null then null else venue_id_param end,
      reservation_provider_connected_at = case when provider_param is null then null else now() end
  where id = partner_id_param;
end;
$$;

revoke all on function public.update_business_reservation_provider(uuid, text, text) from public, anon;
grant execute on function public.update_business_reservation_provider(uuid, text, text) to authenticated;
