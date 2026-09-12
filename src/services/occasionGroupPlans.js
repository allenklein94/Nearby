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
  surpriseMode = false,
  // Item 66 (CLAUDE.md, "Add collaborative planning"): a real, explicit,
  // per-person budget range -- never AI-inferred, honestly null when the
  // organizer leaves it unset.
  budgetMin = null,
  budgetMax = null,
}) {
  const { data, error } = await supabase.rpc('create_occasion_group_plan', {
    occasion_type_param: occasionType,
    title_param: title,
    who_for_name_param: whoForName,
    who_for_friend_id_param: whoForFriendId,
    when_preset_param: whenPreset,
    scheduled_date_param: scheduledDate,
    invitee_ids_param: inviteeIds,
    surprise_mode_param: surpriseMode,
    budget_min_param: budgetMin,
    budget_max_param: budgetMax,
  });
  if (error) throw new Error(error.message);
  return data;
}

// Item 66: the host can promote any joined participant to co-organizer --
// gains exactly one real new power (inviteMoreToOccasionGroupPlan below),
// never decide/cancel authority. Passing false demotes back to a plain
// guest.
export async function setOccasionGroupPlanOrganizer(planId, userId, isOrganizer) {
  const { error } = await supabase.rpc('set_occasion_group_plan_organizer', {
    plan_id_param: planId,
    user_id_param: userId,
    is_organizer_param: isOrganizer,
  });
  if (error) throw new Error(error.message);
}

// Item 66: host or a joined organizer can invite more real friends/matches
// to vote, mid-voting -- same eligibility/surprise-mode-skip rules
// createOccasionGroupPlan's own initial invite already applies.
export async function inviteMoreToOccasionGroupPlan(planId, inviteeIds) {
  const { data, error } = await supabase.rpc('invite_more_to_occasion_group_plan', {
    plan_id_param: planId,
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

// Item 67 (CLAUDE.md, "Let the group vote on businesses"): when the group's
// decided activity type is business-destined (dinner/night_out/activity),
// decideOccasionGroupPlan above moves the plan to 'voting_business' instead
// of 'decided' -- the host's device then fetches real live candidates via
// resolveIntent() (celebrateSomething.js's extractBusinessCandidateIds) and
// proposes them here. Every id is re-verified live server-side before being
// stored as a votable option -- never trusted blindly.
export async function proposeOccasionBusinessOptions(planId, availabilityIds) {
  const { data, error } = await supabase.rpc('propose_occasion_business_options', {
    plan_id_param: planId,
    availability_ids_param: availabilityIds,
  });
  if (error) throw new Error(error.message);
  return data;
}

// Host-only, finalizes the business round -- the winning business_
// availability is re-verified live for real availability before the plan
// moves to 'decided'. The client (GroupOccasionPlanScreen's "Book It")
// still has to call the real submitBusinessRequest(preferredAvailabilityId)
// itself right after this succeeds -- this RPC only records the group's
// decision, since only the client has the host's own real device location
// submitBusinessRequest needs.
export async function decideOccasionGroupPlanBusiness(planId, optionId) {
  const { data, error } = await supabase.rpc('decide_occasion_group_plan_business', {
    plan_id_param: planId,
    option_id_param: optionId,
  });
  if (error) throw new Error(error.message);
  return data;
}

// Escape hatch, host-only: when Nearby finds zero genuine businesses nearby
// for the decided activity type (or the host just wants to browse
// personally), falls back to exactly the pre-Item-67 behavior -- finalizes
// on the original activity-type choice. Returns the same shape
// decideOccasionGroupPlan returns for a non-business destination, so the
// caller can still hand off into CelebrateSomethingScreen via
// resolveDecidedGroupPlanParams.
export async function skipOccasionGroupPlanBusinessVote(planId) {
  const { data, error } = await supabase.rpc('skip_occasion_group_plan_business_vote', {
    plan_id_param: planId,
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
