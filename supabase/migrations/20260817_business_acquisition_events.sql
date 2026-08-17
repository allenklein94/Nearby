-- Business Partner acquisition experience, Milestone 1 (see CLAUDE.md's "Aug 17 2026 -- Business
-- Partner acquisition experience" plan). A real funnel event table, same shape as this schema's
-- own established pattern for exactly this kind of thing (intent_submissions/home_nudge_events):
-- one plain table, no RPC needed for writes, a single admin-gated rollup RPC for the numbers.
--
-- Genuinely different from those two precedents in one real way, not glossed over: the FIRST
-- three funnel steps (landing_viewed/demo_opened/cta_clicked) happen on the new web landing
-- page (Milestone 5), which has no Supabase Auth session at all -- there is no auth.uid() yet.
-- Every later step (search_started onward) happens inside the already-authenticated mobile app,
-- since every real feature in this app already requires a full account (confirmed: the whole
-- app is gated behind `session && profileComplete` in RootNavigator.js -- there is no
-- unauthenticated in-app state to attach an anonymous business-apply flow to). So:
--   - user_id is nullable, populated once a real authenticated write happens, null for the
--     three pre-auth web events.
--   - session_id is a plain client-generated uuid (browser localStorage on web, no persistence
--     needed in-app) used only to group one visitor's own pre-auth web events together --
--     deliberately NOT threaded through app install/sign-up to correlate a specific landing-page
--     visit to the specific application it eventually produced. That kind of cross-surface
--     attribution (e.g. a signed referral token carried through the deep link and sign-up) is
--     real, separate analytics infrastructure -- named here as a genuine future enhancement,
--     not silently faked by pretending session_id already does this.
--   - anon can insert (the web page has no other identity to write as) as well as authenticated
--     -- both scoped by the same real CHECK on `event`, so this can't be used to write arbitrary
--     analytics rows, only ever one of the real named funnel steps. No SELECT is granted to
--     either role -- deny-by-default, matching group_plan_offer_confirmations/
--     friend_discovery_swipes' own precedent for a write-only-by-client, read-only-via-admin-RPC
--     table -- the rollup RPC (get_business_acquisition_funnel_stats) is the only real read path.
create table if not exists public.business_acquisition_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  user_id uuid references public.profiles(id) on delete set null,
  event text not null,
  partner_id uuid references public.brand_partners(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint business_acquisition_events_event_check check (event in (
    'landing_viewed',
    'demo_opened',
    'cta_clicked',
    'search_started',
    'business_found',
    'apply_started',
    'apply_submitted',
    'apply_approved',
    'apply_denied',
    'profile_completed',
    'published',
    'first_offer_created',
    'first_consumer_interaction',
    'dashboard_viewed'
  ))
);

alter table public.business_acquisition_events enable row level security;

create policy "Anyone (including anon) can log a real business-acquisition funnel event"
  on public.business_acquisition_events
  for insert
  to anon, authenticated
  with check (
    (auth.uid() is null and user_id is null)
    or auth.uid() = user_id
  );

revoke all on public.business_acquisition_events from public, anon, authenticated;
grant insert on public.business_acquisition_events to anon, authenticated;

create index if not exists business_acquisition_events_session_id_idx on public.business_acquisition_events(session_id);
create index if not exists business_acquisition_events_event_idx on public.business_acquisition_events(event);
create index if not exists business_acquisition_events_user_id_idx on public.business_acquisition_events(user_id) where user_id is not null;

comment on table public.business_acquisition_events is 'Real funnel-step events for the Business Partner acquisition experience (landing page through first consumer interaction). Write-only for anon/authenticated -- read only via get_business_acquisition_funnel_stats().';

-- Admin-only rollup, matching get_intent_funnel_stats()/get_home_nudge_stats()'s own established
-- shape exactly -- check_is_admin(auth.uid()) gate, every percentage nullif(...,0)-guarded
-- against a zero denominator, real counts only, no fabricated numbers.
create or replace function public.get_business_acquisition_funnel_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_landing_viewed integer;
  v_demo_opened integer;
  v_cta_clicked integer;
  v_search_started integer;
  v_business_found integer;
  v_apply_started integer;
  v_apply_submitted integer;
  v_apply_approved integer;
  v_apply_denied integer;
  v_published integer;
  v_first_offer_created integer;
  v_first_consumer_interaction integer;
begin
  if not check_is_admin(auth.uid()) then
    raise exception 'Only admins can view business acquisition funnel stats';
  end if;

  select count(*) into v_landing_viewed from business_acquisition_events where event = 'landing_viewed';
  select count(*) into v_demo_opened from business_acquisition_events where event = 'demo_opened';
  select count(*) into v_cta_clicked from business_acquisition_events where event = 'cta_clicked';
  select count(*) into v_search_started from business_acquisition_events where event = 'search_started';
  select count(*) into v_business_found from business_acquisition_events where event = 'business_found';
  select count(*) into v_apply_started from business_acquisition_events where event = 'apply_started';
  select count(*) into v_apply_submitted from business_acquisition_events where event = 'apply_submitted';
  select count(*) into v_apply_approved from business_acquisition_events where event = 'apply_approved';
  select count(*) into v_apply_denied from business_acquisition_events where event = 'apply_denied';
  select count(*) into v_published from business_acquisition_events where event = 'published';
  select count(*) into v_first_offer_created from business_acquisition_events where event = 'first_offer_created';
  select count(*) into v_first_consumer_interaction from business_acquisition_events where event = 'first_consumer_interaction';

  return jsonb_build_object(
    'landing_viewed', v_landing_viewed,
    'demo_opened', v_demo_opened,
    'cta_clicked', v_cta_clicked,
    'search_started', v_search_started,
    'business_found', v_business_found,
    'apply_started', v_apply_started,
    'apply_submitted', v_apply_submitted,
    'apply_approved', v_apply_approved,
    'apply_denied', v_apply_denied,
    'published', v_published,
    'first_offer_created', v_first_offer_created,
    'first_consumer_interaction', v_first_consumer_interaction,
    'pct_landing_to_cta', round(100.0 * v_cta_clicked / nullif(v_landing_viewed, 0), 1),
    'pct_cta_to_apply_started', round(100.0 * v_apply_started / nullif(v_cta_clicked, 0), 1),
    'pct_apply_started_to_submitted', round(100.0 * v_apply_submitted / nullif(v_apply_started, 0), 1),
    'pct_submitted_to_approved', round(100.0 * v_apply_approved / nullif(v_apply_submitted, 0), 1),
    'pct_approved_to_published', round(100.0 * v_published / nullif(v_apply_approved, 0), 1)
  );
end;
$$;

revoke all on function public.get_business_acquisition_funnel_stats() from public, anon;
grant execute on function public.get_business_acquisition_funnel_stats() to authenticated;
