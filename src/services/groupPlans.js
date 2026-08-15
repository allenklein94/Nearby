import { supabase } from './supabase';

// "Nearby V3/V4" plan, Phase D (see CLAUDE.md) -- group intent becoming a
// real, jointly-consented business request. Every write here goes through
// a SECURITY DEFINER RPC, matching this schema's own established "no
// direct client INSERT/UPDATE on a lifecycle table" convention. No new
// social surface: every candidate participant still has to come from a
// real, already-open business_requests row belonging to someone the
// caller is genuinely connected to -- the exact same connected-set
// definition Tier 2 / Layer 3 already use, re-validated server-side, not
// trusted from the client.

// Real people you're connected to who already have a real, open request
// in the same category (and, when the source request has one, the same
// date) -- the actual candidate list for "make this a group plan?".
// Reuses the existing Tier 2 RPC verbatim rather than inventing a second
// "who could join a group plan" query.
export async function getGroupPlanCandidates({ category, date = null } = {}) {
  const { data, error } = await supabase.rpc('get_connected_open_business_requests', {
    category_param: category,
    date_start_param: date,
    date_end_param: date,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function proposeGroupPlan(sourceRequestId, inviteeSourceRequestIds) {
  const { data, error } = await supabase.rpc('propose_group_plan', {
    source_request_id_param: sourceRequestId,
    invitee_source_request_ids_param: inviteeSourceRequestIds,
  });
  if (error) throw new Error(error.message);
  return data; // proposal id
}

export async function respondToGroupPlan(proposalId, accept) {
  const { data, error } = await supabase.rpc('respond_to_group_plan', {
    proposal_id_param: proposalId,
    accept_param: accept,
  });
  if (error) throw new Error(error.message);
  return data;
}

// Never a silent average -- the caller must pass a real number within the
// real range the group's own individual budgets support (or null to
// clear it back to "not yet decided"). Changing it after someone already
// accepted resets their consent server-side; the client doesn't need to
// do anything extra for that, just be ready for a participant's status to
// go back to 'invited' on the next fetch.
export async function setGroupPlanBudget(proposalId, agreedBudgetMax) {
  const { data, error } = await supabase.rpc('set_group_plan_budget', {
    proposal_id_param: proposalId,
    agreed_budget_max_param: agreedBudgetMax,
  });
  if (error) throw new Error(error.message);
  return data;
}

// excludeUserIds: participants to explicitly leave out even if they
// already accepted ("continue without Sarah"). Anyone who never accepted
// at all is automatically left out server-side -- no need to list them.
export async function confirmGroupPlan(proposalId, excludeUserIds = []) {
  const { data, error } = await supabase.rpc('confirm_group_plan', {
    proposal_id_param: proposalId,
    exclude_user_ids_param: excludeUserIds,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function cancelGroupPlan(proposalId) {
  const { data, error } = await supabase.rpc('cancel_group_plan', { proposal_id_param: proposalId });
  if (error) throw new Error(error.message);
  return data;
}

export async function leaveGroupPlan(proposalId) {
  const { data, error } = await supabase.rpc('leave_group_plan', { proposal_id_param: proposalId });
  if (error) throw new Error(error.message);
  return data;
}

// One confirmation per (offer, participant). Returns allConfirmed=false
// with the running count until every currently-accepted participant has
// confirmed -- the real accept only fires on the last one.
export async function confirmGroupPlanOffer(proposalId, offerId) {
  const { data, error } = await supabase.rpc('confirm_group_plan_offer', {
    proposal_id_param: proposalId,
    offer_id_param: offerId,
  });
  if (error) throw new Error(error.message);
  return data;
}

// Full detail for the GroupPlan screen: the proposal itself, every real
// participant (with their display name/photo, resolved via a join --
// RLS already scopes group_plan_participants to the caller's own group,
// so this is safe to fetch broadly), and, once confirmed, the resulting
// request's own offers plus who has confirmed each one so far.
export async function getGroupPlanDetail(proposalId) {
  const { data: proposal, error: proposalError } = await supabase
    .from('group_plan_proposals')
    .select('*')
    .eq('id', proposalId)
    .single();
  if (proposalError) throw new Error(proposalError.message);

  const { data: participants, error: participantsError } = await supabase
    .from('group_plan_participants')
    .select('*, profiles(display_name, photo_url)')
    .eq('proposal_id', proposalId)
    .order('created_at', { ascending: true });
  if (participantsError) throw new Error(participantsError.message);

  let offers = [];
  let confirmations = [];
  if (proposal.resulting_request_id) {
    const { data: offerRows, error: offersError } = await supabase
      .from('business_request_offers')
      .select('*, brand_partners(name, logo_url)')
      .eq('request_id', proposal.resulting_request_id)
      .order('created_at', { ascending: true });
    if (offersError) throw new Error(offersError.message);
    offers = offerRows ?? [];

    const { data: confirmRows, error: confirmError } = await supabase
      .from('group_plan_offer_confirmations')
      .select('offer_id, user_id')
      .eq('proposal_id', proposalId);
    if (confirmError) throw new Error(confirmError.message);
    confirmations = confirmRows ?? [];
  }

  return { proposal, participants: participants ?? [], offers, confirmations };
}
