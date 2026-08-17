-- Business Partner acquisition experience, Milestone 4 (see CLAUDE.md): a real, honest answer to
-- the brief's own "know how people are discovering you" framing. Audited what's already on the
-- dashboard first (Phase 0 item 4, re-confirmed live) -- follower/redemption/growth/reliability/
-- visit-frequency/top-interests are all already real and shown, but none of them say *how* a
-- consumer actually found this business's profile in the first place. Milestone 3's new
-- nearby://business/:id deep link is the first genuinely new, honestly-distinguishable signal
-- this app has ever had for that question -- a profile view either arrived via that link (QR
-- code or a shared link -- both open the identical URL, so this table can't and doesn't claim to
-- tell them apart, matching this schema's own "no invented numbers" convention) or it didn't
-- (browsing/search/a linked gathering-perk-card/community-update row/etc., all folded into one
-- honest 'in_app' bucket rather than fabricating a finer breakdown the client can't actually
-- observe). Same plain-table, no-RPC-for-writes shape as business_acquisition_events -- one
-- owner-gated rollup RPC for reads, not a raw SELECT grant.
create table if not exists public.business_profile_views (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.brand_partners(id) on delete cascade,
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  source text not null,
  created_at timestamptz not null default now(),
  constraint business_profile_views_source_check check (source in ('deep_link', 'in_app'))
);

alter table public.business_profile_views enable row level security;

-- Unlike business_acquisition_events, this table has no pre-auth use case at all -- a business
-- profile view only ever happens from inside the already-authenticated mobile app (confirmed
-- the same way that migration's own header comment already did: the whole app is gated behind
-- `session && profileComplete`) -- so this is authenticated-only, no anon insert path.
create policy "A real viewer can log their own profile view"
  on public.business_profile_views
  for insert
  to authenticated
  with check (auth.uid() = viewer_id);

revoke all on public.business_profile_views from public, anon, authenticated;
grant insert on public.business_profile_views to authenticated;

create index if not exists business_profile_views_partner_id_idx on public.business_profile_views(partner_id);
create index if not exists business_profile_views_partner_created_idx on public.business_profile_views(partner_id, created_at);

comment on table public.business_profile_views is 'One row per real, distinguishable profile-view event (deep_link vs in_app) -- write-only for authenticated, read only via get_business_discovery_stats().';

-- Ownership check matches the already-established fix shape for this whole RPC family
-- (get_business_dashboard_stats/_growth/_top_members/_visit_frequency/_insights, from the Aug 7
-- "Business RPC ownership check" security fix) -- return zeroed/null stats for a non-owner
-- rather than raising, so this doesn't leak whether a given partner_id even exists via an error
-- message either.
create or replace function public.get_business_discovery_stats(partner_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
  v_deep_link integer;
  v_in_app integer;
  v_last_30d integer;
begin
  if not exists (select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param) then
    return jsonb_build_object(
      'total_views', 0, 'deep_link_views', 0, 'in_app_views', 0,
      'views_last_30_days', 0, 'pct_via_deep_link', null
    );
  end if;

  select count(*) into v_total from business_profile_views where partner_id = partner_id_param;
  select count(*) into v_deep_link from business_profile_views where partner_id = partner_id_param and source = 'deep_link';
  select count(*) into v_in_app from business_profile_views where partner_id = partner_id_param and source = 'in_app';
  select count(*) into v_last_30d from business_profile_views where partner_id = partner_id_param and created_at > now() - interval '30 days';

  return jsonb_build_object(
    'total_views', v_total,
    'deep_link_views', v_deep_link,
    'in_app_views', v_in_app,
    'views_last_30_days', v_last_30d,
    'pct_via_deep_link', round(100.0 * v_deep_link / nullif(v_total, 0), 1)
  );
end;
$$;

revoke all on function public.get_business_discovery_stats(uuid) from public, anon;
grant execute on function public.get_business_discovery_stats(uuid) to authenticated;
