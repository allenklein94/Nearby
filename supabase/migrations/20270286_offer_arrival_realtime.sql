-- Offer arrival signal, Layer 1 (owner, 2026-10-09): the app listens for changes to business_request_offers so a reply to
-- the person's own open request can be announced in-app while they are using it (services/offerArrivals.js).
-- Realtime evaluates the table's existing SELECT policies for every subscriber, so nobody receives a change to a row they
-- could not already read (requester, match/group-plan participants, plan organizers, the business itself, approved
-- attendees for an accepted offer). The client drops the payload and re-reads (offerArrivalSource.js). No policy, grant,
-- column or function changes. Idempotent, same shape as 20261109_plan_group_chat.sql.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'business_request_offers'
     ) then
    execute 'alter publication supabase_realtime add table public.business_request_offers';
  end if;
end $$;
