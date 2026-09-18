import { supabase } from './supabase';

// Item 52 ("Build a universal Plan object", CLAUDE.md) -- the first real
// client consumer of the `plans` table (Phase G,
// 20260914_plans_unified_object.sql). That table has existed since Sep 14
// 2026, populated additively by triggers on gatherings/business_requests/
// date_proposals, but was read by nothing in the client at all until now
// (confirmed live: the Item 51 migration, 20261014_cancellation_lifecycle_
// propagation.sql, explicitly re-verified "no `.from('plans')` call exists
// anywhere in src/" as of that pass).
//
// Locked scope, a direct user decision ("wire the client first" over
// completing the data model or building a dedicated new Plans screen):
// reuse the existing PlansScreen surface (no new navigation destination),
// and read real `plans` rows only for the two plan_types that screen had
// ZERO visibility into before this -- a solo business request (asked but
// never merged into a Group Plan) and a dating date proposal. Both used to
// be entirely invisible on "your complete commitment calendar," the exact
// ad-hoc-query gap the user's own advisor called out.
//
// Deliberately NOT touched: gathering-sourced plans. PlansScreen's existing
// getMyAttendingGatherings()/getMyGatherings() queries stay exactly as they
// are -- attending a gathering someone else hosts has no `plans` row at
// all (RLS is `created_by`-only; there's no participant concept on this
// table yet), and inventing one now would be exactly the speculative
// schema complexity the locked decision says not to add in this pass.
export async function getMyStandaloneBusinessRequestPlans() {
  const { data, error } = await supabase
    .from('plans')
    .select(
      'id, title, scheduled_at, party_size, budget_max, status, resulting_business_request_id, ' +
        'business_requests!plans_resulting_business_request_id_fkey(category, group_plan_id)'
    )
    .eq('plan_type', 'business_request')
    .not('resulting_business_request_id', 'is', null)
    .neq('status', 'cancelled')
    .order('scheduled_at', { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);

  // A request already merged into a Group Plan is already shown via
  // getMyGroupPlans() (services/groupPlans.js) -- excluded here so it
  // isn't rendered twice. business_requests.group_plan_id is not synced
  // onto plans.status (a real, disclosed gap in the Phase G migration's
  // own header comment), so this has to be checked directly rather than
  // inferred from status.
  return (data ?? []).filter((row) => !row.business_requests?.group_plan_id);
}

// A date_proposal-sourced plan has no scheduled_at (a proposal is a real
// invite with a plan_text, not a fixed timestamp yet -- create_plan_from_
// date_proposal() never sets one), so there's no "upcoming vs past" split
// to make here the same way gathering rows get one; every non-cancelled
// row is just "still a live plan."
//
// Item 59 fix ("Thursday acceptance test", Journey B): a date-proposal
// row can be plan_type 'friend_hangout' now, not just 'dating_date'
// (20261015_friend_sourced_plan_type_fix.sql -- a "Plan Something
// Together" made from a Friends-tab connection is not a romantic date).
// Both are fetched here since resulting_date_proposal_id already scopes
// this query to proposal-sourced rows only (a gathering-sourced
// friend_hangout plan has resulting_gathering_id set instead, never this
// column) -- plan_type is also selected so the caller can render the
// right icon/label instead of assuming "date proposal" always means
// romantic.
export async function getMyDateProposalPlans() {
  const { data, error } = await supabase
    .from('plans')
    .select(
      'id, title, plan_type, status, resulting_date_proposal_id, ' +
        'date_proposals!plans_resulting_date_proposal_id_fkey(match_id)'
    )
    .in('plan_type', ['dating_date', 'friend_hangout'])
    .not('resulting_date_proposal_id', 'is', null)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

// Universal Plan read layer (20261203_plan_read_layer.sql). `plans` is the aggregation identity: occasions and group
// occasion plans now have their own rows, and downstream gathering/business-request plans hang under them via
// parent_plan_id. get_plan_overview returns everything about ONE plan in one response -- who, occasion, group plan,
// activity, business request, offers, reservation, children, and a lifecycle of real facts. New Plan functionality
// should read through this instead of building another ad-hoc union across the underlying tables.
// Returns null when the caller has no access to the plan (or it doesn't exist).
export function normalizePlanOverview(raw) {
  if (!raw || !raw.plan) return null;
  const who = raw.who || {};
  const lifecycle = raw.lifecycle || {};
  return {
    plan: raw.plan,
    who: {
      host: who.host || null,
      forName: who.for_name || null,
      organizers: who.organizers || [],
      participants: who.participants || [],
      guestCount: who.guest_count || 0,
      attendeeCount: who.attendee_count || 0,
    },
    match: raw.match || null,
    occasion: raw.occasion || null,
    groupPlan: raw.group_plan || null,
    activity: raw.activity || null,
    businessRequest: raw.business_request || null,
    dateProposalId: raw.date_proposal_id || null,
    offers: raw.offers || [],
    reservation: raw.reservation || null,
    parent: raw.parent || null,
    children: raw.children || [],
    lifecycle: {
      status: lifecycle.status || raw.plan.status,
      hasActivity: !!lifecycle.has_activity,
      hasBusiness: !!lifecycle.has_business,
      hasOffer: !!lifecycle.has_offer,
      hasAcceptedOffer: !!lifecycle.has_accepted_offer,
      hasReservation: !!lifecycle.has_reservation,
      reservationStatus: lifecycle.reservation_status || null,
    },
  };
}

export async function getPlanOverview(planId) {
  const { data, error } = await supabase.rpc('get_plan_overview', { plan_id_param: planId });
  if (error) throw new Error(error.message);
  return normalizePlanOverview(data);
}

// Resolves the plans row behind a dating/friend match for either participant (get_plan_id_for_match; plans RLS is
// creator-only). Null when the caller isn't in the match.
export async function getPlanIdForMatch(matchId) {
  const { data, error } = await supabase.rpc('get_plan_id_for_match', { match_id_param: matchId });
  if (error) throw new Error(error.message);
  return data ?? null;
}

// Resolves the plans row behind a standalone gathering or business request for anyone who may view that plan
// (get_plan_id_for_resource -- host/requester, approved attendees, group-plan/match participants). kind is
// 'gathering' | 'business_request'. Null when there is no plan or the caller can't see it.
export async function getPlanIdForResource(kind, resourceId) {
  const { data, error } = await supabase.rpc('get_plan_id_for_resource', { kind_param: kind, resource_id_param: resourceId });
  if (error) throw new Error(error.message);
  return data ?? null;
}

// Resolves the plans row behind an occasion (creator only -- plans RLS is creator-only) or an occasion group plan
// (host or any invited participant, via get_plan_id_for_group_plan).
export async function getPlanIdForOccasion({ occasionId = null, groupPlanId = null }) {
  if (groupPlanId) {
    const { data, error } = await supabase.rpc('get_plan_id_for_group_plan', { group_plan_id_param: groupPlanId });
    if (error) throw new Error(error.message);
    return data ?? null;
  }
  const { data, error } = await supabase.from('plans').select('id').eq('occasion_id', occasionId).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}
