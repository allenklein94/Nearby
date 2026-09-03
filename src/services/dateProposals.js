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
// Batched, list-shaped counterpart to getLatestDateProposal()/
// getMatchBusinessRequest() -- MatchesScreen renders a whole list of
// matches at once, and a real per-row query for each one would be an N+1
// fetch. Three real, already-RLS-scoped queries (each already correctly
// widened to both match participants, not just whichever one submitted
// the request -- "The Offer System" Phase 5's own is_match_participant()
// policies) instead of one query per row, returned as a map keyed by
// match_id so a caller can just look up `plans[matchId]`.
export async function getMyActivePlansByMatch(matchIds) {
  if (!matchIds || matchIds.length === 0) return {};

  const { data: proposals, error: pErr } = await supabase
    .from('date_proposals')
    .select('id, match_id, status, created_at')
    .in('match_id', matchIds)
    .order('created_at', { ascending: false });
  if (pErr) throw new Error(pErr.message);

  // Most recent proposal per match, regardless of status -- same "one real
  // current answer, not a full history" rule getLatestDateProposal()
  // already uses for a single match.
  const latestByMatch = {};
  for (const p of proposals ?? []) {
    if (!latestByMatch[p.match_id]) latestByMatch[p.match_id] = p;
  }

  const { data: requests, error: rErr } = await supabase
    .from('business_requests')
    .select('id, match_id, status, party_size')
    .in('match_id', matchIds)
    .in('status', ['open', 'fulfilled']);
  if (rErr) throw new Error(rErr.message);

  const requestByMatch = {};
  for (const r of requests ?? []) requestByMatch[r.match_id] = r;

  const requestIds = (requests ?? []).map((r) => r.id);
  const acceptedByRequest = {};
  // Aug 30 2026 (CLAUDE.md, "unfinished plan" persistent-state follow-up):
  // same widened in-clause as getGatheringPlaceStatuses -- gives every row
  // a real "N businesses found" / "N offers, choose one" sub-state at no
  // extra query.
  const offerCountsByRequest = {};
  if (requestIds.length > 0) {
    const { data: offers, error: oErr } = await supabase
      .from('business_request_offers')
      .select('id, request_id, status, proposed_time, offer_type, offer_price, offer_description, brand_partners(name, latitude, longitude, address)')
      .in('request_id', requestIds)
      .in('status', ['pending', 'offered', 'accepted', 'completed']);
    if (oErr) throw new Error(oErr.message);
    for (const o of offers ?? []) {
      if (o.status === 'accepted' || o.status === 'completed') {
        acceptedByRequest[o.request_id] = o;
      } else {
        const counts = (offerCountsByRequest[o.request_id] ??= { pendingCount: 0, offeredCount: 0 });
        if (o.status === 'offered') counts.offeredCount += 1;
        else counts.pendingCount += 1;
      }
    }
  }

  const result = {};
  for (const matchId of matchIds) {
    const proposal = latestByMatch[matchId] ?? null;
    const businessRequest = requestByMatch[matchId] ?? null;
    const acceptedOffer = businessRequest ? acceptedByRequest[businessRequest.id] ?? null : null;
    const offerCounts = businessRequest
      ? offerCountsByRequest[businessRequest.id] ?? { pendingCount: 0, offeredCount: 0 }
      : { pendingCount: 0, offeredCount: 0 };
    result[matchId] = { proposal, businessRequest, acceptedOffer, ...offerCounts };
  }
  return result;
}

export async function createBusinessRequestForMatch({
  matchId,
  text,
  category = null,
  budgetMax = null,
  date = null,
  timeWindowStart = null,
  timeWindowEnd = null,
  radiusMiles = 15,
  occasion = null,
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
    occasion_param: occasion,
    date_param: date,
    time_window_start_param: timeWindowStart,
    time_window_end_param: timeWindowEnd,
    radius_miles_param: radiusMiles,
  });
  if (error) throw new Error(error.message);
  return { requestId: data.requestId, notifiedCount: data.notifiedCount, partySize: data.partySize, duplicate: !!data.duplicate };
}
