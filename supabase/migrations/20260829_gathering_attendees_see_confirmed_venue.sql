-- P0 #1 from the Aug 28 2026 Full End-to-End Product Coherence Audit
-- (CLAUDE.md's own Aug 29 2026 remediation plan): once a gathering's host
-- accepted a real business offer, only the host could ever see the
-- confirmed venue -- every other approved attendee still only saw the
-- gathering's own original coordinates, with zero indication a real
-- venue had been confirmed. Both new policies are purely additive --
-- they never narrow anything an existing caller could already see.
--
-- gathering_interest's own live "Anyone can see approved attendees" SELECT
-- policy (status = 'approved') is a plain boolean condition with no
-- reference back to either table below, so referencing it directly from
-- a new policy on business_requests/business_request_offers carries no
-- recursion risk -- same reasoning already proven safe by
-- business_request_offers' own pre-existing "Requesters can view offers
-- on their own requests" policy (a plain EXISTS on business_requests from
-- business_request_offers, live in production today).

create policy "Approved gathering attendees can view the resulting request"
on public.business_requests for select
using (
  gathering_id is not null
  and exists (
    select 1 from public.gathering_interest gi
    where gi.gathering_id = business_requests.gathering_id
    and gi.user_id = auth.uid()
    and gi.status = 'approved'
  )
);

-- Deliberately scoped to accepted/completed only -- an attendee should see
-- the real confirmed venue once it exists, never a business's own
-- pending/declined bid (that's the host's own decision-making context,
-- not something every attendee needs visibility into).
create policy "Approved gathering attendees can view the accepted offer"
on public.business_request_offers for select
using (
  status in ('accepted', 'completed')
  and exists (
    select 1 from public.business_requests br
    join public.gathering_interest gi on gi.gathering_id = br.gathering_id
    where br.id = business_request_offers.request_id
    and br.gathering_id is not null
    and gi.user_id = auth.uid()
    and gi.status = 'approved'
  )
);
