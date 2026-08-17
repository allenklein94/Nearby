-- Business Partner acquisition experience, Milestone 6 (see CLAUDE.md): closes the last of the
-- 5 previously-unfired funnel steps found while preparing end-to-end verification --
-- first_consumer_interaction. Deliberately built server-side, as a real AFTER INSERT trigger on
-- business_profile_views, not a client-side check -- a consumer viewing a business's profile
-- (the caller here) cannot and should not be able to tell how many prior views that business has
-- had (get_business_discovery_stats is owner-gated for exactly this reason, per Milestone 4's own
-- migration), so there is no honest way to compute "is this the first view" client-side without
-- either a new consumer-facing RPC leaking a business's view history, or trusting an unverifiable
-- client claim. A real NOT EXISTS check against the same business_profile_views table Milestone
-- 4 already built is the honest, server-verified version of the same signal -- fires exactly once
-- per partner, on the row that genuinely is that partner's first-ever logged consumer view.
-- BusinessProfileScreen.js's existing logBusinessProfileView() call (Milestone 4, already fires
-- on every genuine consumer view, already excludes the owner's own profile preview via its
-- `myPartner?.id !== partnerId` guard) needs no change -- this trigger observes writes that
-- already happen, it doesn't require a new one.
create or replace function public.log_first_consumer_interaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from business_profile_views
    where partner_id = new.partner_id and id <> new.id
  ) then
    insert into business_acquisition_events (session_id, user_id, event, partner_id)
    values (gen_random_uuid(), new.viewer_id, 'first_consumer_interaction', new.partner_id);
  end if;
  return new;
end;
$$;

drop trigger if exists on_business_profile_view_log_first_interaction on public.business_profile_views;
create trigger on_business_profile_view_log_first_interaction
  after insert on public.business_profile_views
  for each row execute function public.log_first_consumer_interaction();

revoke all on function public.log_first_consumer_interaction() from public, anon, authenticated;
