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
