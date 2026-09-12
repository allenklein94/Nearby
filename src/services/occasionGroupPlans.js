// "Group planning for an Occasion" (CLAUDE.md, direct user follow-up to the
// Occasion rename/simplify pass). User's own example: "Sarah's 30th
// Birthday," invite 8 friends, everyone proposes/votes on what to do
// (Italian dinner / Bowling / Concert), Nearby turns the winner into a real
// plan via the existing business pipeline
// (CelebrateSomethingScreen.js's own 'options' step -- see
// resolveDecidedGroupPlanParams below). DB layer:
// supabase/migrations/20261020_occasion_group_plans.sql. Every write here
// goes through a SECURITY DEFINER RPC, same "no direct client INSERT/UPDATE
// on a lifecycle table" convention this schema always uses.
import { supabase } from './supabase';

export async function createOccasionGroupPlan({
  occasionType,
  title,
  whoForName = null,
  whoForFriendId = null,
  whenPreset = null,
  scheduledDate = null,
  inviteeIds = [],
}) {
  const { data, error } = await supabase.rpc('create_occasion_group_plan', {
    occasion_type_param: occasionType,
    title_param: title,
    who_for_name_param: whoForName,
    who_for_friend_id_param: whoForFriendId,
    when_preset_param: whenPreset,
    scheduled_date_param: scheduledDate,
    invitee_ids_param: inviteeIds,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function respondToOccasionGroupPlan(planId, accept) {
  const { error } = await supabase.rpc('respond_to_occasion_group_plan', {
    plan_id_param: planId,
    accept,
  });
  if (error) throw new Error(error.message);
}

export async function proposeOccasionOption(planId, activityType, label = null) {
  const { data, error } = await supabase.rpc('propose_occasion_option', {
    plan_id_param: planId,
    activity_type_param: activityType,
    label_param: label,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function castOccasionVote(optionId, voting) {
  const { error } = await supabase.rpc('cast_occasion_vote', {
    option_id_param: optionId,
    voting_param: voting,
  });
  if (error) throw new Error(error.message);
}

export async function getOccasionGroupPlanDetail(planId) {
  const { data, error } = await supabase.rpc('get_occasion_group_plan_detail', {
    plan_id_param: planId,
  });
  if (error) throw new Error(error.message);
  return data;
}

// Returns the same decided-plan shape CelebrateSomethingScreen's own
// resolveDecidedGroupPlanParams() consumes (occasionType/title/whoForName/
// whoForFriendId/whenPreset/scheduledDate/activityType/label/partySize) --
// the host is the only one who can call this (enforced server-side).
export async function decideOccasionGroupPlan(planId, optionId) {
  const { data, error } = await supabase.rpc('decide_occasion_group_plan', {
    plan_id_param: planId,
    option_id_param: optionId,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function cancelOccasionGroupPlan(planId) {
  const { error } = await supabase.rpc('cancel_occasion_group_plan', {
    plan_id_param: planId,
  });
  if (error) throw new Error(error.message);
}

// "Occasion architecture should not be a silo" (CLAUDE.md, direct user
// request): links a decided group plan to the real `plans` row that its
// downstream gathering/business_request creation already produced --
// transitions the plan's own status to 'fulfilled' once linked. Best-
// effort by design; see link_occasion_group_plan_to_plan's own SQL comment.
export async function linkOccasionGroupPlanToPlan({ groupPlanId, resultingGatheringId = null, resultingBusinessRequestId = null }) {
  const { error } = await supabase.rpc('link_occasion_group_plan_to_plan', {
    group_plan_id_param: groupPlanId,
    resulting_gathering_id_param: resultingGatheringId,
    resulting_business_request_id_param: resultingBusinessRequestId,
  });
  if (error) console.error('linkOccasionGroupPlanToPlan error', error);
}

export async function getMyOccasionGroupPlans() {
  const { data, error } = await supabase.rpc('get_my_occasion_group_plans');
  if (error) {
    console.error('getMyOccasionGroupPlans error', error);
    return [];
  }
  return data ?? [];
}
