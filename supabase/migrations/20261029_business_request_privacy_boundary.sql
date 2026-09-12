-- Item 69 (CLAUDE.md): "Businesses shouldn't need to know the person's
-- identity." Locked, direct user answer: a strict two-stage boundary.
--
-- PRE-ACCEPTANCE: a business sees only what it needs to decide whether to
-- make an offer -- occasion, party size, date/time window, budget,
-- attributes/cuisine -- never a real name.
--
-- POST-ACCEPTANCE (a genuine confirmed reservation): the business is now
-- actually operating the reservation, so it gets the primary requester's
-- real display name -- and NOTHING else (no phone, no photo, no other
-- profile field, no other participant's identity). Nearby doesn't collect
-- a phone number anywhere on profiles, so there is nothing to reveal
-- there even if it were "operationally necessary" -- not fabricated here.
-- Never for a match-sourced (dating) request: "Two people planning to
-- visit" (describeVisit(), BusinessDashboardScreen.js) is an existing,
-- separately deliberate anonymization for dating requests, predating this
-- item -- this reveal must not silently override it.
--
-- Two concrete pre-acceptance leaks existed before this migration, fixed
-- at the WRITE side in this same commit (celebrateSomething.js,
-- GatheringDetailScreen.js): composeCelebrationAskText() spliced a real
-- picked name ("Sarah's Birthday") into the free text handed to
-- submitBusinessRequest() as raw_text, and GatheringDetailScreen's "Ask
-- Local Businesses Now" sent a gathering's own real (host-chosen, equally
-- name-capable) title verbatim as raw_text. Both are now business-safe,
-- generic text with no name spliced in, for every future write.
--
-- This migration closes the two structural READ-side gaps a write-side
-- text fix alone can't close, per the user's own explicit instruction to
-- enforce this "across ... RPCs and database authorization -- not just by
-- hiding fields in the client":
--
-- 1. getBusinessOpportunities()'s own embedded gatherings(title, ...)
--    re-exposes a linked gathering's real (possibly name-bearing) title a
--    SECOND, independent way, regardless of what raw_text says. Fixed by
--    never returning a gathering's title to a business at all -- only its
--    non-identity interest_tag, category-shaped like every other signal a
--    business already sees.
-- 2. The "Businesses can view requests they've received an opportunity
--    for" RLS policy on business_requests grants full-row SELECT
--    (including requester_id, a real profile FK) the instant an
--    opportunity row exists -- not exploited by any shipped query today,
--    but nothing in the schema stops a future one from asking for it.
--    Closed by replacing the business's entire read path with a
--    SECURITY DEFINER RPC whose column list is fixed in the function
--    body -- requester_id can never leave this function no matter what a
--    client requests, a real DB-authorization-level guarantee rather than
--    a client-side choice not to ask for it.

create or replace function public.get_business_opportunities(partner_id_param uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_result jsonb;
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    raise exception 'Not authorized for this business';
  end if;

  select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb)
  into v_result
  from (
    select
      bro.id, bro.request_id, bro.partner_id, bro.offer_type, bro.offer_price,
      bro.offer_description, bro.proposed_time, bro.created_at, bro.expires_at,
      bro.responded_at, bro.accepted_at, bro.completed_at, bro.status,
      bro.availability_id, bro.viewed_at, bro.decline_reason, bro.decline_note,
      bro.experience_id, bro.media_path, bro.media_type, bro.cancelled_at, bro.package_id,
      jsonb_build_object(
        'raw_text', br.raw_text,
        'category', br.category,
        'party_size', br.party_size,
        'budget_min', br.budget_min,
        'budget_max', br.budget_max,
        'date', br.date,
        'time_window_start', br.time_window_start,
        'time_window_end', br.time_window_end,
        'status', br.status,
        'expires_at', br.expires_at,
        'gathering_id', br.gathering_id,
        'match_id', br.match_id,
        'attributes', br.attributes,
        'cuisine', br.cuisine,
        'occasion', br.occasion,
        'gatherings', case when g.id is not null then jsonb_build_object(
          'interest_tag', g.interest_tag,
          'scheduled_at', g.scheduled_at,
          'price_level', g.price_level,
          'party_type', g.party_type
        ) else null end,
        -- Item 69's post-acceptance reveal: the primary requester's real
        -- display name, only once THIS offer is a genuine confirmed
        -- reservation, and never for a dating-sourced request (see
        -- header comment).
        'requester_display_name', case
          when bro.status in ('accepted', 'completed') and br.match_id is null
          then req.display_name
          else null
        end
      ) as business_requests,
      case when bres.id is not null then jsonb_build_object(
        'status', bres.status,
        'business_payments', case when bp.id is not null then jsonb_build_object('status', bp.status) else null end
      ) else null end as business_reservations
    from public.business_request_offers bro
    join public.business_requests br on br.id = bro.request_id
    left join public.gatherings g on g.id = br.gathering_id
    left join public.profiles req on req.id = br.requester_id
    left join public.business_reservations bres on bres.offer_id = bro.id
    left join public.business_payments bp on bp.reservation_id = bres.id
    where bro.partner_id = partner_id_param
  ) t;

  return v_result;
end;
$$;

revoke all on function public.get_business_opportunities(uuid) from public, anon;
grant execute on function public.get_business_opportunities(uuid) to authenticated;

-- Superseded by the function above -- every business-side read now goes
-- through it, which structurally cannot leak requester_id. The
-- requester's own "Requesters can view their own business requests"
-- policy (unrelated, untouched) still lets a consumer read their own row
-- directly for getBusinessRequestWithOffers() and every other consumer-
-- side query in businessFulfillment.js/dateProposals.js/groupPlans.js/
-- gatherings.js -- none of those depend on the policy dropped here (all
-- separately confirmed scoped to requester_id/gathering_id/match_id/
-- group_plan_id filters under that other, unrelated policy).
drop policy if exists "Businesses can view requests they've received an opportunity for" on public.business_requests;
