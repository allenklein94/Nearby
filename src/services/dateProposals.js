import * as Location from 'expo-location';
import { supabase } from './supabase';

// "The Offer System" Phase 5 (see CLAUDE.md's own plan, Decision 4): the
// locked Match -> Proposal -> Other person accepts -> Dating Experience ->
// Business Request shape. Every write here goes through a SECURITY
// DEFINER RPC, matching this schema's own established "no direct client
// write on a lifecycle table" convention -- Match != Date is enforced
// server-side (propose_date/respond_to_date_proposal/withdraw_date_
// proposal), never just by hiding the wrong button client-side.

export async function proposeDate(matchId, planText) {
  const { data, error } = await supabase.rpc('propose_date', {
    match_id_param: matchId,
    plan_text_param: planText,
  });
  if (error) throw new Error(error.message);
  return data; // { proposalId, status }
}

export async function respondToDateProposal(proposalId, accept) {
  const { data, error } = await supabase.rpc('respond_to_date_proposal', {
    proposal_id_param: proposalId,
    accept_param: accept,
  });
  if (error) throw new Error(error.message);
  return data; // { success, status }
}

export async function withdrawDateProposal(proposalId) {
  const { error } = await supabase.rpc('withdraw_date_proposal', { proposal_id_param: proposalId });
  if (error) throw new Error(error.message);
}

// The one real, currently-relevant proposal for a match, if any -- the
// most recent one, regardless of status. RLS already scopes this to a
// real participant of the match, so no ownership filter is needed here.
export async function getLatestDateProposal(matchId) {
  const { data, error } = await supabase
    .from('date_proposals')
    .select('*')
    .eq('match_id', matchId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

// The real resulting business_requests row for this match, if the
// accepted plan has already been turned into a business ask -- checked
// so the UI can offer "View Request" instead of re-prompting to ask
// businesses again. Scoped to a still-open or already-fulfilled request,
// same "not a dead/expired/cancelled one" convention as the gathering/
// group-plan paths use for their own duplicate checks.
export async function getMatchBusinessRequest(matchId) {
  const { data, error } = await supabase
    .from('business_requests')
    .select('id, status')
    .eq('match_id', matchId)
    .in('status', ['open', 'fulfilled'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

// Requires real device location, same as submitBusinessRequest() -- a
// match has no stored coordinates of its own to read server-side the way
// a gathering does, so there's no honest "location optional" path here
// either.
export async function createBusinessRequestForMatch({
  matchId,
  text,
  category = null,
  budgetMax = null,
  date = null,
  timeWindowStart = null,
  timeWindowEnd = null,
  radiusMiles = 15,
}) {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Location access is needed to find nearby businesses.');
  }
  const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });

  const { data, error } = await supabase.rpc('create_business_request_for_match', {
    match_id_param: matchId,
    raw_text_param: text,
    latitude_param: location.coords.latitude,
    longitude_param: location.coords.longitude,
    category_param: category,
    budget_max_param: budgetMax,
    date_param: date,
    time_window_start_param: timeWindowStart,
    time_window_end_param: timeWindowEnd,
    radius_miles_param: radiusMiles,
  });
  if (error) throw new Error(error.message);
  return { requestId: data.requestId, notifiedCount: data.notifiedCount, partySize: data.partySize, duplicate: !!data.duplicate };
}
