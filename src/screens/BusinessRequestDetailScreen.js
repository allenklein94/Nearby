import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, ActivityIndicator, Alert, Image, Platform, Linking } from 'react-native';
import * as Calendar from 'expo-calendar';
import { NLoader, SuccessAnimation, ModeTransition } from '../motion';
import { useFocusEffect } from '@react-navigation/native';
import { useStripe, initStripe } from '@stripe/stripe-react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { getBusinessRequestWithOffers, acceptBusinessOffer, cancelBusinessRequest, completeBusinessReservation, cancelBusinessReservation, getPartnerAvgResponseTime, getPartnerOfferReputation, formatPartnerReliabilityLine, markBusinessOfferViewed, getSignedBusinessOfferMediaUrl, createPlanAddonRequest, getPlanAddons, removePlanAddon, setPlanItemTime, getPlanOrganizers, addPlanOrganizer, removePlanOrganizer } from '../services/businessFulfillment';
import { getPlanChatInfo } from '../services/planChat';
import { relevantAddonTypesForOccasion, planAddonIcon, planAddonLabel } from '../constants/planAddons';
import { occasionIcon, occasionLabel } from '../constants/businessAttributes';
import { buildPlanTimeline, summarizePlanTimelineReadiness, buildPlanSummary, addonStateCopy } from '../utils/planAddonReadiness';
import { buildPlanCalendarEvent, buildDirectionsUrl } from '../utils/planLogisticsActions';
import { buildOccasionPlanShareCaption } from '../utils/occasionPlanShareCard';
import { stripTrailingCelebrationIcon, buildPlanHeaderChangeKey } from '../utils/livingPlanHeader';
import OccasionPlanShareCard from '../components/OccasionPlanShareCard';
import CelebrationHeaderIcon from '../components/CelebrationHeaderIcon';
import StaggeredReveal from '../components/StaggeredReveal';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { getGroupPlanCandidates, proposeGroupPlan, inviteToBusinessRequest } from '../services/groupPlans';
import { getConnectedPeopleWithInterests } from '../services/surpriseMe';
import { recordIntentSelection } from '../services/intentOutcomes';
import { createBusinessPaymentIntent, isStripeConfigured, STRIPE_PUBLISHABLE_KEY } from '../services/stripeConnect';
import { openUberToDestination } from '../utils/uberDeepLink';
import { PICK_DATE_KEY } from './AskBusinessScreen';
import { NearbyMark } from '../components/brand';
import { supabase } from '../services/supabase';
import LoadErrorState from '../components/LoadErrorState';
import OfferOutcomeModal from '../components/OfferOutcomeModal';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

const STATUS_COPY = {
  open: { label: 'Open — waiting for responses', color: null },
  fulfilled: { label: 'You accepted an offer', color: 'primary' },
  expired: { label: 'This request expired', color: null },
  cancelled: { label: 'You cancelled this request', color: null },
  merged: { label: 'Combined into a group plan', color: 'primary' },
};

const OFFER_STATUS_COPY = {
  pending: 'Waiting for a response',
  offered: 'Made you an offer',
  accepted: 'Accepted — your reservation',
  declined: "Can't help with this one",
  // Item 50 (state consistency audit, Finding 4): withdraw_business_offer()
  // is a real, live transition this map was missing -- fell through to the
  // raw literal "withdrawn" instead of styled copy. Matches
  // GroupPlanScreen's identical business-offer copy map, kept in sync.
  withdrawn: 'Withdrawn',
  expired: 'No longer available',
  cancelled: 'Cancelled',
  completed: 'Completed',
};

// Offer System Phase 3 (see CLAUDE.md's own plan, Gap 3): offer_type was
// already real and stored (never hard-coded to a discount, per the
// original locked decisions) but had never actually been rendered
// anywhere on this screen -- part of Phase 3's "clearer per-offer terms
// summary."
const OFFER_TYPE_LABELS = {
  standard: 'Standard offer',
  discount: 'Discount',
  perk: 'Perk',
  upgrade: 'Upgrade',
  alt_time: 'Alternate time',
};

// business_request_offers.proposed_time was previously collected nowhere
// (the "Alt. time" offer-type chip had no time input attached to it at
// all) and rendered nowhere -- PRODUCT_AUDIT/
// INTENT_LAYER_UX_WALKTHROUGH_2026-08-14.md, finding 3. Now that
// BusinessDashboardScreen's "Make an Offer" modal actually collects it,
// render it here too, both before and after acceptance.
function formatProposedTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Phase 4 (media upload, CLAUDE.md) -- a real uploaded offer photo,
// rendered INSIDE this screen's own existing offer card, never as a
// standalone card. Video shown as an honest label, not a fabricated
// inline player -- no video player component exists elsewhere in this
// codebase to mirror.
function OfferMediaPreview({ path, type, colors }) {
  const [signedUrl, setSignedUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (path) {
      getSignedBusinessOfferMediaUrl(path).then((url) => {
        if (!cancelled) setSignedUrl(url);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (!path) return null;
  if (type === 'video') {
    return <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs }}>🎬 Video attached</Text>;
  }
  if (!signedUrl) return null;
  return (
    <Image
      source={{ uri: signedUrl }}
      style={{ width: '100%', height: 140, borderRadius: radius.md, marginTop: spacing.xs }}
      resizeMode="cover"
    />
  );
}


// The consumer-side offer-review/accept screen -- Phase 2 of the Intent
// Layer plan (CLAUDE.md). Reached right after submitting a request
// (AskBusinessScreen) and, later, via a real push notification
// (business_offer_received/business_offer_accepted) when a business
// responds -- no separate "My Requests" list screen was built this pass,
// matching the plan's own "a consumer-side offer-review/accept screen"
// (singular) scope; revisiting a request relies on the push deep link,
// same as this app's established gathering_invite precedent.
export default function BusinessRequestDetailScreen({ navigation, route }) {
  const { colors, shadow, isDark } = useTheme();
  const styles = getStyles(colors, shadow);
  const requestId = route.params?.requestId;
  const justSubmitted = route.params?.justSubmitted ?? false;
  const notifiedCount = route.params?.notifiedCount ?? 0;
  const isDuplicate = route.params?.duplicate ?? false;
  // Item 55 fast-follow ("deep links should preserve context too" --
  // CLAUDE.md): a business_offer_received/business_offer_withdrawn/
  // business_reservation_cancelled notification tap already carries the
  // real reason (the push's own body text) -- see notifications.js. No
  // forced action here (unlike GatheringDetail's Invite Friends case): the
  // offer list right below is already the obvious next thing to look at,
  // so a second competing CTA would just be noise.
  const notificationReason = route.params?.notificationReason ?? null;
  const [showReasonBanner, setShowReasonBanner] = useState(!!notificationReason);
  // "ok do it" (CLAUDE.md): the Occasion wizard's own real "Involve" step
  // now precedes a business-destined ask's "Options" step -- these are
  // that real selection carried forward, same shape
  // GatheringConfirmationScreen's suggestedInviteeIds already established.
  // Never auto-invited: pre-highlights + pre-checks the boxes below, but
  // sending still requires the explicit "Send Invite" tap it already did.
  const suggestedInviteeIds = route.params?.suggestedInviteeIds ?? null;
  const suggestedInviteeLabel = route.params?.suggestedInviteeLabel ?? null;
  // load() re-runs on every focus (useFocusEffect below) -- this ref
  // makes the pre-selection below a one-time seed, not something that
  // silently re-clobbers the user's own later edits (unchecking a
  // suggestion, adding someone else, or closing the panel) every time
  // they navigate away and back to this same screen.
  const suggestionAppliedRef = useRef(false);
  const [request, setRequest] = useState(null);
  // Finding 4: the original ask's own fields, carried forward so "Try a
  // Wider Radius" can push a fresh, pre-filled AskBusiness instead of
  // sending the user back to a blank form. Item 56 ("no dead ends"): a
  // revisit that never carried these route.params at all (e.g. a push tap,
  // which only ever carries requestId + notificationReason) used to fall
  // through to a blank AskBusiness -- now falls back to the real fetched
  // request row's own fields (loaded below), so "Try a Wider Radius" is
  // never a dead retry.
  const prefillFields = {
    prefillText: route.params?.prefillText ?? request?.raw_text ?? null,
    prefillCategory: route.params?.prefillCategory ?? request?.category ?? null,
    prefillPartySize: route.params?.prefillPartySize ?? request?.party_size ?? null,
    prefillBudgetMax: route.params?.prefillBudgetMax ?? request?.budget_max ?? null,
    prefillDateWindow: route.params?.prefillDateWindow ?? (request?.date ? PICK_DATE_KEY : null),
    // P0 #2 fix (CLAUDE.md, Aug 29 2026): carry a real picked date forward
    // too, not just its dateWindow key -- without this, a retry after
    // picking a specific date would silently lose it and fall back to
    // "flexible" (PICK_DATE_KEY alone means nothing without the ISO
    // string next to it).
    prefillPickedDateISO: route.params?.prefillPickedDateISO ?? (request?.date ? new Date(request.date).toISOString() : null),
    prefillOccasion: route.params?.prefillOccasion ?? null,
    prefillSubmissionId: route.params?.prefillSubmissionId ?? null,
    gatheringId: route.params?.gatheringId ?? null,
    gatheringTitle: route.params?.gatheringTitle ?? null,
    gatheringPartySize: route.params?.gatheringPartySize ?? null,
    matchId: route.params?.matchId ?? null,
    matchName: route.params?.matchName ?? null,
    communityId: route.params?.communityId ?? null,
    communityName: route.params?.communityName ?? null,
  };
  const priorRadiusMiles = route.params?.prefillRadiusMiles ?? request?.radius_miles ?? 15;
  const widerRadiusMiles = priorRadiusMiles < 30 ? 30 : 50;

  function handleTryWiderRadius() {
    navigation.push('AskBusiness', { ...prefillFields, prefillRadiusMiles: widerRadiusMiles });
  }

  // Stripe Connect direct-charge payment collection (CLAUDE.md's 2026-08-27
  // locked Decision 2). Safe to call unconditionally regardless of whether
  // isStripeConfigured() is true -- this SDK's hooks don't throw for a
  // missing StripeProvider, they just fail at actual call time, which is
  // why collectPayment() below explicitly gates on isStripeConfigured()
  // before ever calling initPaymentSheet/presentPaymentSheet.
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [collectingPayment, setCollectingPayment] = useState(false);

  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [actingOfferId, setActingOfferId] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  // Success state (per the Nearby Motion Language): accepting an offer used to be a
  // silent state re-render (CLAUDE.md Item 57's own disclosed, unbuilt gap) -- now a
  // brief, self-clearing celebration, distinct from the Plan Status pill's own
  // permanent "Confirmed" label just below it (that one stays forever; this one is
  // the one-time moment of it becoming true).
  const [justAccepted, setJustAccepted] = useState(false);
  const justAcceptedTimerRef = useRef(null);
  // 10/10 roadmap Part 5 (see CLAUDE.md's "10/10 roadmap" plan) --
  // partnerId -> { reputation, responseTime }, fetched for every partner
  // with a real offer showing, so the consumer isn't blind to whether a
  // business actually follows through before deciding whether to accept.
  const [partnerStats, setPartnerStats] = useState({});
  // "Nearby V3/V4" plan, Phase D (see CLAUDE.md) -- group intent -> a real
  // jointly-consented request. Three real, independent signals sourced
  // from this exact request, none fabricated: real connected people with
  // a real open request in the same category (candidates to invite),
  // whether this exact request is itself someone else's invite waiting
  // on the caller (myPendingGroupPlanId), and whether this request was
  // already combined into a confirmed group plan (via superseded_by_
  // group_plan_id / group_plan_id, both plain columns on `request`).
  const [myId, setMyId] = useState(null);
  const [groupPlanCandidates, setGroupPlanCandidates] = useState([]);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState([]);
  const [myPendingGroupPlanId, setMyPendingGroupPlanId] = useState(null);
  const [proposingGroupPlan, setProposingGroupPlan] = useState(false);
  // Item 36 chain 1 (CLAUDE.md): "Invite someone" -- deliberately separate
  // from groupPlanCandidates above. That list only ever covers people who
  // already, coincidentally, have their own open request in this same
  // category; this covers ANY real connection (accepted friend or active
  // match), invited directly into THIS request via invite_to_business_
  // request -- the actual gap the chain-1 audit found. An inline
  // expand-in-place section (Progressive Depth doctrine), not a new
  // screen.
  // Item 80 ("Make it special," CLAUDE.md), extended by Item 81 ("One
  // Plan can contain multiple businesses") into a real chronological
  // timeline: real, independent add-on business_requests attached to
  // this primary request. addonActionKey tracks which specific entry is
  // mid-action (add/retry/remove/retime), for a per-row spinner -- never
  // a screen-wide loading lock, since one add-on's action must never
  // block another's independent lifecycle.
  const [addons, setAddons] = useState([]);
  const [addonActionKey, setAddonActionKey] = useState(null);
  // The one shared inline "add a new entry" / "retime an existing one"
  // compose panel -- only one open at a time, per this app's own
  // Progressive Depth doctrine (expand in place, never a new screen for
  // a small structured input). mode 'add' carries `type`; mode 'edit'
  // carries `requestId` + the entry's current label/time to prefill.
  const [timelineForm, setTimelineForm] = useState(null);
  const [timelineFormLabel, setTimelineFormLabel] = useState('');
  const [timelineFormTime, setTimelineFormTime] = useState(null);
  const [showTimelineTimePicker, setShowTimelineTimePicker] = useState(false);
  const [showInviteSomeone, setShowInviteSomeone] = useState(false);
  const [connections, setConnections] = useState([]);
  const [selectedInviteeIds, setSelectedInviteeIds] = useState([]);
  const [invitingSomeone, setInvitingSomeone] = useState(false);
  // Item 88 (CLAUDE.md, "Let multiple people organize the same occasion"):
  // null until a successful get_plan_organizers() -- the RPC itself only
  // ever returns for someone who's genuinely authorized (host or an
  // already-added co-organizer), so a non-null value here IS "I organize
  // this plan," with no separate flag needed. A rejected fetch (any other
  // viewer of this screen -- a match participant, a gathering-interest-
  // approved attendee) just means the whole Organizers section, and the
  // broadened Invite/add-on authority below, stay off for them.
  const [planOrganizerInfo, setPlanOrganizerInfo] = useState(null);
  const [showOrganizers, setShowOrganizers] = useState(false);
  const [organizerActionBusy, setOrganizerActionBusy] = useState(false);
  // Item 89 ("Give the occasion a single shared conversation"): same
  // "presence is the gate" shape as planOrganizerInfo above -- null until
  // a successful get_plan_chat_info(), which only ever succeeds for a
  // real participant of the plan behind this request (host, organizer, or
  // an accepted invitee). A rejected fetch just means no chat link shows.
  const [planChatInfo, setPlanChatInfo] = useState(null);
  const [selectedNewOrganizerId, setSelectedNewOrganizerId] = useState(null);
  // Offer System outcome capture (CLAUDE.md, Aug 23 2026): the real "did it
  // go well?" step, asked right after a real completeBusinessReservation()
  // success -- never before, matching GatheringFeedbackModal's own "only
  // ask after it actually happened" convention.
  const [outcomeModalOfferId, setOutcomeModalOfferId] = useState(null);

  // "Nearby V3/V4" plan, Phase C: order the consumer's own offer list by
  // the same real completion-rate signal Phase C's fan-out now prefers,
  // once several live offers exist to actually choose between -- reusing
  // the already-fetched partnerStats, no new query. Deliberately scoped
  // to just the 'offered' rows (the ones a consumer is genuinely deciding
  // between) rather than re-sorting the whole timeline -- pending/
  // declined/accepted/expired/completed rows keep their existing
  // created_at position, matching the plan's own "a partner below the
  // threshold is never penalized -- it's ordered exactly where it would
  // have landed today" for every row this reordering doesn't touch.
  const displayOffers = useMemo(() => {
    const offeredIndices = [];
    offers.forEach((o, i) => { if (o.status === 'offered') offeredIndices.push(i); });
    if (offeredIndices.length < 2) return offers;

    function reliabilityRank(offer) {
      const rep = partnerStats[offer.partner_id]?.reputation;
      const established = !!rep && rep.total_opportunities >= 5;
      return { established, completionRate: established ? (rep.completion_rate ?? -1) : null };
    }
    const reordered = offeredIndices
      .map((i) => offers[i])
      .sort((a, b) => {
        const rankA = reliabilityRank(a);
        const rankB = reliabilityRank(b);
        if (rankA.established !== rankB.established) return rankA.established ? -1 : 1;
        if (rankA.established) return rankB.completionRate - rankA.completionRate;
        return 0; // neither established -- stable sort preserves original (created_at) order
      });
    const result = [...offers];
    offeredIndices.forEach((originalIndex, k) => { result[originalIndex] = reordered[k]; });
    return result;
  }, [offers, partnerStats]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData?.session?.user?.id ?? null;
      setMyId(uid);

      const result = await getBusinessRequestWithOffers(requestId);
      setRequest(result.request);
      setOffers(result.offers);
      setLoadError(false);

      // Item 88: awaited (not fire-and-forget) because the Invite-Someone
      // and add-on-authority checks just below need to know organizer
      // status synchronously, not after a later re-render. A rejection
      // here (any viewer who isn't the host or an already-added organizer)
      // is expected and silent -- it just means those sections stay off.
      let organizerInfo = null;
      try {
        organizerInfo = await getPlanOrganizers(requestId);
      } catch (e) {
        organizerInfo = null;
      }
      setPlanOrganizerInfo(organizerInfo);
      const isOrganizerNow = !!organizerInfo;

      // Item 89: same best-effort, silent-on-rejection shape as the
      // organizer fetch just above -- most viewers of this screen aren't
      // part of the plan's chat and that's expected, not an error.
      try {
        setPlanChatInfo(await getPlanChatInfo(requestId));
      } catch (e) {
        setPlanChatInfo(null);
      }

      // Item 80: an add-on's own detail view never gets its own nested
      // "Make it special" section (no addon-of-addon) -- only a primary
      // request fetches its real add-ons.
      if (!result.request.addon_type) {
        getPlanAddons(requestId)
          .then((rows) => setAddons(rows))
          .catch((e) => console.error('getPlanAddons failed', e));
      } else {
        setAddons([]);
      }

      // Phase 3: a real, honest read receipt -- the requester's own
      // session is genuinely looking at every currently-offered row on
      // this exact screen right now, so mark each one viewed. The RPC
      // is idempotent (only ever sets viewed_at once) and internally
      // scoped to the real requester, so this is safe to fire
      // unconditionally regardless of who's viewing.
      result.offers
        .filter((o) => o.status === 'offered' && !o.viewed_at)
        .forEach((o) => markBusinessOfferViewed(o.id));

      const partnerIds = [...new Set(result.offers.filter((o) => o.status === 'offered' || o.status === 'accepted').map((o) => o.partner_id))];
      if (partnerIds.length > 0) {
        Promise.all(
          partnerIds.map(async (id) => [id, await Promise.all([getPartnerOfferReputation(id), getPartnerAvgResponseTime(id)])])
        )
          .then((entries) => setPartnerStats(Object.fromEntries(entries.map(([id, [reputation, responseTime]]) => [id, { reputation, responseTime }]))))
          .catch((e) => console.error('getPartnerOfferReputation/getPartnerAvgResponseTime failed', e));
      }

      // Real candidates to invite into a group plan: connected people who
      // already have a real, open request in the same category. Only
      // worth fetching for the caller's own open request -- no signal
      // to compute if it's someone else's, already resolved, or has no
      // category at all.
      if (result.request.status === 'open' && result.request.requester_id === uid && result.request.category) {
        getGroupPlanCandidates({ category: result.request.category, date: result.request.date })
          .then((candidates) => setGroupPlanCandidates(candidates.filter((c) => c.id !== requestId)))
          .catch((e) => console.error('getGroupPlanCandidates failed', e));
      } else {
        setGroupPlanCandidates([]);
      }

      // Item 36 chain 1: who could the owner invite into this exact
      // request? Real connections only, gated the same way as the
      // candidates list above (own, still-open, real-category request),
      // plus excluding a request that's already the resulting row of a
      // confirmed group plan -- invite_to_business_request only makes
      // sense pre-confirmation.
      // Item 88: broadened from "only the requester" to "the requester OR
      // any real co-organizer of the plan" -- "everyone can help... invite
      // people" is one of this item's own concrete examples. Also now the
      // one real candidate pool the host's own "+ Add Co-Organizer" picker
      // below reuses, so it's fetched whenever the caller organizes this
      // plan at all, not just for an open, categorized, non-merged request
      // -- that narrower gate still independently controls whether the
      // Invite Someone section itself renders, further down.
      if (isOrganizerNow || (result.request.status === 'open' && result.request.requester_id === uid && result.request.category && !result.request.group_plan_id)) {
        getConnectedPeopleWithInterests()
          .then((people) => {
            setConnections(people);
            // "ok do it" (CLAUDE.md): pre-check + auto-expand for a real
            // wizard-suggested selection -- intersected against this
            // request's own real connections (both draw from the same
            // getMyFriends()/getMyMatches() universe, so this is never a
            // stale or foreign id), never trusted blindly. Still requires
            // the existing explicit "Send Invite" tap below.
            if (!suggestionAppliedRef.current && suggestedInviteeIds && suggestedInviteeIds.length > 0) {
              suggestionAppliedRef.current = true;
              const validIds = suggestedInviteeIds.filter((id) => people.some((p) => p.id === id));
              if (validIds.length > 0) {
                setSelectedInviteeIds(validIds);
                setShowInviteSomeone(true);
              }
            }
          })
          .catch((e) => console.error('getConnectedPeopleWithInterests failed', e));
      } else {
        setConnections([]);
        setShowInviteSomeone(false);
      }

      // Is this exact request itself an invite someone else sent the
      // caller, still waiting on a response?
      if (uid) {
        supabase
          .from('group_plan_participants')
          .select('proposal_id')
          .eq('source_request_id', requestId)
          .eq('user_id', uid)
          .eq('status', 'invited')
          .maybeSingle()
          .then(({ data }) => setMyPendingGroupPlanId(data?.proposal_id ?? null))
          .catch((e) => console.error('group_plan_participants pending-invite check failed', e));
      }
    } catch (e) {
      setLoadError(true);
    }
    setLoading(false);
  }, [requestId]);

  function toggleGroupPlanCandidate(id) {
    setSelectedCandidateIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleProposeGroupPlan() {
    if (selectedCandidateIds.length === 0) return;
    setProposingGroupPlan(true);
    try {
      const proposalId = await proposeGroupPlan(requestId, selectedCandidateIds);
      // Phase 3 item 2 (CLAUDE.md): the propose-time group-plan moment,
      // previously invisible to the funnel -- only confirm-time was
      // logged (see GroupPlanScreen.js's handleConfirm/handleConfirmOffer).
      // No submissionId here either, same honest reasoning as those two
      // call sites: a group plan is formed from several participants'
      // own separate asks, not one single originating submission.
      recordIntentSelection({
        rawText: null,
        category: request?.category ?? null,
        dateWindow: request?.date ?? null,
        resultType: 'group_plan_proposed',
        resultId: proposalId,
        resultTitle: `Group plan proposed — ${request?.category ?? 'shared request'}`,
      });
      navigation.replace('GroupPlan', { proposalId });
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setProposingGroupPlan(false);
  }

  function toggleInviteeSelection(id) {
    setSelectedInviteeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleInviteSomeone() {
    if (selectedInviteeIds.length === 0) return;
    setInvitingSomeone(true);
    try {
      const { proposalId } = await inviteToBusinessRequest(requestId, selectedInviteeIds);
      recordIntentSelection({
        rawText: null,
        category: request?.category ?? null,
        dateWindow: request?.date ?? null,
        resultType: 'group_plan_proposed',
        resultId: proposalId,
        resultTitle: `Invited someone — ${request?.category ?? 'shared request'}`,
      });
      navigation.navigate('GroupPlan', { proposalId });
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setInvitingSomeone(false);
  }

  // Item 88 ("Let multiple people organize the same occasion," CLAUDE.md):
  // host-only -- reuses the same `connections` list already loaded for
  // Invite Someone above (both draw from the same real accepted-friend/
  // active-match universe), so no second fetch is needed.
  async function handleAddOrganizer() {
    if (!selectedNewOrganizerId) return;
    setOrganizerActionBusy(true);
    try {
      await addPlanOrganizer(requestId, selectedNewOrganizerId);
      setSelectedNewOrganizerId(null);
      const refreshed = await getPlanOrganizers(requestId);
      setPlanOrganizerInfo(refreshed);
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setOrganizerActionBusy(false);
  }

  async function handleRemoveOrganizer(userId, displayName) {
    Alert.alert(
      'Remove co-organizer?',
      `${displayName ?? 'This person'} will no longer be able to help manage this plan.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setOrganizerActionBusy(true);
            try {
              await removePlanOrganizer(requestId, userId);
              const refreshed = await getPlanOrganizers(requestId);
              setPlanOrganizerInfo(refreshed);
            } catch (e) {
              Alert.alert('Error', e.message);
            }
            setOrganizerActionBusy(false);
          },
        },
      ]
    );
  }

  // Item 81 ("One Plan can contain multiple businesses," CLAUDE.md):
  // each handler acts on exactly one entry's own independent lifecycle --
  // adding a second Transportation entry (a different time/label) never
  // touches the first, and vice versa. The shared compose panel
  // (timelineForm) drives both "add a new entry" and "retime an existing
  // one" through the same small UI.
  function openAddForm(typeKey) {
    setTimelineForm({ mode: 'add', type: typeKey });
    setTimelineFormLabel('');
    setTimelineFormTime(null);
  }

  function openEditForm(entry) {
    setTimelineForm({ mode: 'edit', requestId: entry.requestId, addonType: entry.addonType });
    setTimelineFormLabel(entry.rawLabel ?? '');
    if (entry.hasTime && entry.planTime) {
      const [h, m] = entry.planTime.split(':').map((n) => parseInt(n, 10));
      const d = new Date();
      d.setHours(h, m, 0, 0);
      setTimelineFormTime(d);
    } else {
      setTimelineFormTime(null);
    }
  }

  function closeTimelineForm() {
    setTimelineForm(null);
    setTimelineFormLabel('');
    setTimelineFormTime(null);
    setShowTimelineTimePicker(false);
  }

  function timelineFormTimeString() {
    if (!timelineFormTime) return null;
    return `${String(timelineFormTime.getHours()).padStart(2, '0')}:${String(timelineFormTime.getMinutes()).padStart(2, '0')}`;
  }

  async function submitTimelineForm() {
    if (!timelineForm) return;
    const busyKey = timelineForm.mode === 'add' ? timelineForm.type : timelineForm.requestId;
    setAddonActionKey(busyKey);
    try {
      const label = timelineFormLabel.trim() || null;
      const timeStr = timelineFormTimeString();
      if (timelineForm.mode === 'add') {
        const result = await createPlanAddonRequest(requestId, timelineForm.type, label, timeStr);
        const rows = await getPlanAddons(requestId);
        setAddons(rows);
        if (result.notifiedCount === 0) {
          Alert.alert('Added', "We couldn't find a nearby business for this yet — we'll keep it open in case one joins.");
        }
      } else {
        await setPlanItemTime(timelineForm.requestId, timeStr, label, label === null);
        const rows = await getPlanAddons(requestId);
        setAddons(rows);
        await load();
      }
      closeTimelineForm();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setAddonActionKey(null);
  }

  async function handleRemoveEntry(entry) {
    setAddonActionKey(entry.requestId);
    try {
      await removePlanAddon(entry.requestId);
      const rows = await getPlanAddons(requestId);
      setAddons(rows);
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setAddonActionKey(null);
  }

  async function handleRetryEntry(entry) {
    setAddonActionKey(entry.requestId);
    try {
      // Only a still-'open' declined attempt needs cancelling first --
      // an already-terminal (expired) attempt doesn't block a fresh
      // create_plan_addon_request call at all.
      if (entry.state === 'declined') {
        await removePlanAddon(entry.requestId);
      }
      const result = await createPlanAddonRequest(requestId, entry.addonType, entry.rawLabel, entry.hasTime ? entry.planTime : null);
      const rows = await getPlanAddons(requestId);
      setAddons(rows);
      if (result.notifiedCount === 0) {
        Alert.alert('Added', "We couldn't find a nearby business for this yet — we'll keep it open in case one joins.");
      }
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setAddonActionKey(null);
  }

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function handleAccept(offerId) {
    setActingOfferId(offerId);
    try {
      const result = await acceptBusinessOffer(offerId);
      await load();
      setJustAccepted(true);
      clearTimeout(justAcceptedTimerRef.current);
      justAcceptedTimerRef.current = setTimeout(() => setJustAccepted(false), 3200);
      // accept_business_offer() itself already confirmed the real
      // reservation ('nearby' provider) regardless of payment -- this is
      // purely the follow-up payment-collection step, never a condition
      // for the accept/reservation itself succeeding.
      if (result?.paymentRequired) {
        await collectPayment(offerId);
      }
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setActingOfferId(null);
  }

  useEffect(() => () => clearTimeout(justAcceptedTimerRef.current), []);

  // The real Stripe Connect direct-charge flow: create_business_payment_intent
  // returns a real client_secret scoped to the accepting business's own
  // connected account; PaymentSheet confirms it against that account, so
  // the charge (and any dispute) lands on the business, not Nearby -- only
  // Nearby's own application fee is collected automatically on the side.
  async function collectPayment(offerId) {
    if (!isStripeConfigured()) {
      Alert.alert(
        'Payment not yet available',
        "This business collects payment through Nearby, but that isn't fully set up yet — reach out to them directly to arrange payment for now. Your reservation is still confirmed."
      );
      return;
    }
    setCollectingPayment(true);
    try {
      const { clientSecret, stripeAccountId, amount } = await createBusinessPaymentIntent(offerId);
      await initStripe({ publishableKey: STRIPE_PUBLISHABLE_KEY, stripeAccountId });
      const { error: initError } = await initPaymentSheet({
        paymentIntentClientSecret: clientSecret,
        merchantDisplayName: 'Nearby',
      });
      if (initError) throw new Error(initError.message);
      const { error: presentError } = await presentPaymentSheet();
      if (presentError) {
        if (presentError.code !== 'Canceled') {
          Alert.alert('Payment not completed', presentError.message);
        }
        return;
      }
      Alert.alert('Payment sent', `Your $${Number(amount).toFixed(2)} payment is on its way to the business.`);
      await load();
    } catch (e) {
      Alert.alert('Payment error', e.message);
    }
    setCollectingPayment(false);
  }

  async function handleComplete(offerId) {
    setActingOfferId(offerId);
    try {
      await completeBusinessReservation(offerId);
      await load();
      setOutcomeModalOfferId(offerId);
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setActingOfferId(null);
  }

  // Item 50 (CLAUDE.md) fix 5: "this fell through" -- either party may
  // cancel a confirmed reservation. The RPC's own "already paid, contact
  // the business" rejection surfaces here unchanged.
  function handleCancelReservation(offerId) {
    Alert.alert('Cancel this reservation?', "The business will be notified and any held spot will be released.", [
      { text: 'Never mind', style: 'cancel' },
      {
        text: 'Cancel Reservation', style: 'destructive', onPress: async () => {
          setActingOfferId(offerId);
          try {
            await cancelBusinessReservation(offerId);
            await load();
          } catch (e) {
            Alert.alert('Error', e.message);
          }
          setActingOfferId(null);
        },
      },
    ]);
  }

  async function handleCancel() {
    Alert.alert('Cancel this request?', 'Businesses will no longer be able to respond.', [
      { text: 'Never mind', style: 'cancel' },
      {
        text: 'Cancel Request', style: 'destructive', onPress: async () => {
          setCancelling(true);
          try {
            await cancelBusinessRequest(requestId);
            await load();
          } catch (e) {
            Alert.alert('Error', e.message);
          }
          setCancelling(false);
        },
      },
    ]);
  }

  if (loading && !request) {
    return (
      <SafeAreaView style={styles.container}>
        <NLoader fullScreen={false} />
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadErrorState message="Couldn't load this request." onRetry={load} />
      </SafeAreaView>
    );
  }

  if (!request) return null;

  const statusCopy = STATUS_COPY[request.status] ?? { label: request.status, color: null };
  const hasWinner = offers.some((o) => o.status === 'accepted' || o.status === 'completed');
  const isGroupPlanRequest = !!request.group_plan_id;
  const isMergedIntoGroupPlan = request.status === 'merged' && !!request.superseded_by_group_plan_id;
  // Offer System Phase 3 (see CLAUDE.md's own plan): the real evidence
  // bar per Decision 1 -- Request -> 0..N Offers was already the live
  // model, this just decides when it's genuinely worth a comparison
  // treatment. Below 2 concurrent live offers (the common case for a
  // long while), the screen renders exactly as it always has -- no
  // fabricated "comparison" of one thing against nothing.
  const offeredCount = offers.filter((o) => o.status === 'offered').length;
  const showComparison = offeredCount >= 2;

  // Item 80 ("Make it special"), extended by Item 81 into a real
  // chronological timeline: a relevant, occasion-aware add-on type list
  // for the primary request only (relevantAddonTypesForOccasion is a
  // pure, deterministic lookup -- no AI, never shown for an add-on's own
  // detail view), plus the actual sorted timeline of the primary + every
  // live (non-cancelled) add-on. canAddAddons gates new add/retry
  // actions on the primary still being genuinely open -- existing
  // entries stay visible and viewable regardless. Unlike Item 80's
  // original one-slot-per-type model, a type already in the timeline
  // stays offered in "Add to your plan" -- a second Transportation entry
  // at a different time is a real, intended case now, not a mistake to
  // block.
  const relevantAddonTypes = relevantAddonTypesForOccasion(request.occasion ?? null);
  const planTimeline = useMemo(
    () => buildPlanTimeline({ primary: request, primaryOffers: offers, addons }),
    [request, offers, addons]
  );
  const planReadinessLabel = summarizePlanTimelineReadiness(planTimeline);
  // Item 90 ("the Plan itself becomes the source of truth" -- CLAUDE.md):
  // one real, single canonical summary block -- shown only on the
  // primary's own screen, same as "Your Plan" below, since an add-on
  // already links back to the full plan via the banner above.
  const planSummary = useMemo(
    () => (request.addon_type ? null : buildPlanSummary({
      primary: request,
      primaryOffers: offers,
      planTitle: planChatInfo?.title ?? null,
      // Item 120 ("Plan creation should feel like a major achievement"): the mock's own Who,
      // sourced from the plan's own already-fetched real roster/occasion who-for -- never a new
      // query.
      participants: planChatInfo?.participants ?? null,
      myId,
      whoForName: planChatInfo?.whoForName ?? null,
    })),
    [request, offers, planChatInfo, myId]
  );

  // Item 112 follow-up (CLAUDE.md, "the finished plan could have a living
  // header... 🎂 Sarah's 30th Birthday"): only once the plan is genuinely
  // finished (statusKind 'confirmed', the same gate the share-card action
  // below already uses) -- a plan still in progress keeps the plain
  // static title, since "finished" is the whole premise of this treatment.
  const planHeaderIcon = useMemo(
    () => occasionIcon(planChatInfo?.occasionType ?? request.occasion ?? null) ?? '🎉',
    [planChatInfo, request.occasion]
  );
  const planHeaderLabel = useMemo(
    () => (planSummary ? stripTrailingCelebrationIcon(planSummary.title, planHeaderIcon) : ''),
    [planSummary, planHeaderIcon]
  );
  const planHeaderChangeKey = useMemo(() => buildPlanHeaderChangeKey(planSummary), [planSummary]);
  // Item 88: this used to be visible to ANY viewer who could load this
  // screen at all (including a match participant or gathering-interest-
  // approved attendee who could never actually succeed at the underlying
  // RPC) -- a real, disclosed pre-existing gap this item's own
  // organizer-authority check happens to close for free. Now genuinely
  // matches who can succeed: the requester (planOrganizerInfo resolves for
  // them too, since is_plan_organizer treats the plan's own created_by as
  // an implicit organizer) or a real added co-organizer.
  const isOrganizer = !!planOrganizerInfo;
  const canAddAddons = request.status === 'open' && isOrganizer;

  // Item 107 (CLAUDE.md): "Build the occasion around a beautiful
  // shareable card" -- once the plan is genuinely finalized (Item 91's
  // 'confirmed' status, the same real state this card's own pill already
  // shows), render it off-screen and let the user share the captured
  // image through the native share sheet ("Messages, text, etc.").
  const shareCardRef = useRef(null);
  const [sharingPlanCard, setSharingPlanCard] = useState(false);
  // Item 120 ("Plan creation should feel like a major achievement"): "Invite / Share Plan"
  // co-located as the finale's two actions. Share already existed; Invite is real and unblocked
  // regardless of status via add_plan_organizer (organizing authority, not "grow the reservation
  // size" -- the actual invite_to_business_request RPC is hard-gated to status='open' server-side
  // for good reason, since a confirmed reservation is already sized for a specific party and
  // silently letting more people claim a seat on it would misrepresent a real booking to the
  // business). This quick-link reuses that already-built, already-safe Organizers section below
  // rather than inventing a second invite mechanism.
  const scrollViewRef = useRef(null);
  const organizersSectionYRef = useRef(0);
  function goInviteFromAchievementCard() {
    setShowOrganizers(true);
    requestAnimationFrame(() => {
      scrollViewRef.current?.scrollTo?.({ y: Math.max(organizersSectionYRef.current - spacing.lg, 0), animated: true });
    });
  }

  // Item 121 ("Business offer acceptance should feel equally tangible"): Add to Calendar / Get
  // Directions / Get an Uber, appearing immediately once a plan is genuinely confirmed. Add to
  // Calendar uses createEventInCalendarAsync -- the native OS compose UI, where the USER
  // themselves reviews and taps Save -- never a silent background write, honoring the spirit of
  // CLAUDE.md's own locked "Calendar = when, Nearby = what+who+where+how" read-only boundary (a
  // single, user-confirmed export of one already-real commitment, not Nearby becoming a calendar
  // management surface).
  const [addingToCalendar, setAddingToCalendar] = useState(false);
  async function handleAddToCalendar() {
    const event = buildPlanCalendarEvent({
      title: planSummary?.title,
      rawDate: planSummary?.rawDate,
      rawTime: planSummary?.rawTime,
      businessAddress: planSummary?.businessAddress,
      location: planSummary?.location,
    });
    if (!event) {
      Alert.alert("Couldn't add to calendar", "This plan doesn't have a confirmed date yet.");
      return;
    }
    setAddingToCalendar(true);
    try {
      await Calendar.createEventInCalendarAsync(event);
    } catch (e) {
      Alert.alert("Couldn't open your calendar", e.message ?? 'Please try again.');
    }
    setAddingToCalendar(false);
  }

  function handleGetDirections() {
    const url = buildDirectionsUrl({
      latitude: planSummary?.businessLatitude,
      longitude: planSummary?.businessLongitude,
      address: planSummary?.businessAddress,
    });
    if (!url) return;
    Linking.openURL(url).catch(() => Alert.alert('Error', "Couldn't open Maps."));
  }

  function handleGetUberForPlan() {
    if (planSummary?.businessLatitude == null || planSummary?.businessLongitude == null) return;
    openUberToDestination({
      latitude: planSummary.businessLatitude,
      longitude: planSummary.businessLongitude,
      nickname: planSummary.location,
      address: planSummary.businessAddress,
    }).catch(() => Alert.alert('Error', "Couldn't open Uber."));
  }

  async function handleSharePlanCard() {
    if (!planSummary || !shareCardRef.current) return;
    setSharingPlanCard(true);
    try {
      const uri = await captureRef(shareCardRef, { format: 'png', quality: 1 });
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert("Sharing isn't available on this device.");
        return;
      }
      await Sharing.shareAsync(`file://${uri}`, {
        mimeType: 'image/png',
        dialogTitle: planSummary.title,
      });
    } catch (e) {
      Alert.alert('Error', "Couldn't create the shareable card. Try again.");
    }
    setSharingPlanCard(false);
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView ref={scrollViewRef} contentContainerStyle={{ padding: spacing.lg }}>
        {/* Item 122 ("Don't overanimate the business experience"): accepting a business's offer
            is a reservation locking in -- a business TRANSACTION, not an occasion-creation
            moment -- so it should feel fast + trustworthy + reassuring, not festive. Reverted
            from Item 120's "It's happening. 🎉" (which was calibrated for the plan-CREATION
            moment, still correct below at justSubmitted) back to the plain "Reservation
            confirmed. ✓" phrasing GroupPlanScreen already uses for this exact same real
            moment, with tone="business" (skips the ✨ discovery beat, settles fast, no
            springy bounce). */}
        {justAccepted && <SuccessAnimation haptic text="Reservation confirmed. ✓" tone="business" />}
        {planSummary && (
          <View style={styles.planSummaryCard}>
            <View style={styles.planSummaryHeaderRow}>
              {planSummary.statusKind === 'confirmed' ? (
                <View style={styles.planSummaryTitleRow}>
                  <CelebrationHeaderIcon
                    icon={planHeaderIcon}
                    changeKey={planHeaderChangeKey}
                    size={20}
                    style={styles.planSummaryTitleIcon}
                  />
                  <Text style={styles.planSummaryTitle} numberOfLines={2}>{planHeaderLabel}</Text>
                </View>
              ) : (
                <Text style={styles.planSummaryTitle} numberOfLines={2}>{planSummary.title}</Text>
              )}
              <View
                style={[
                  styles.planSummaryStatusPill,
                  planSummary.statusKind === 'confirmed' && styles.planSummaryStatusPillConfirmed,
                  planSummary.statusKind === 'cancelled' && styles.planSummaryStatusPillCancelled,
                  (planSummary.statusKind === 'option_selected' || planSummary.statusKind === 'booking_pending') && styles.planSummaryStatusPillInProgress,
                  planSummary.statusKind === 'completed' && styles.planSummaryStatusPillCompleted,
                ]}
              >
                <Text
                  style={[
                    styles.planSummaryStatusText,
                    planSummary.statusKind === 'confirmed' && styles.planSummaryStatusTextConfirmed,
                    planSummary.statusKind === 'cancelled' && styles.planSummaryStatusTextCancelled,
                    (planSummary.statusKind === 'option_selected' || planSummary.statusKind === 'booking_pending') && styles.planSummaryStatusTextInProgress,
                    planSummary.statusKind === 'completed' && styles.planSummaryStatusTextCompleted,
                  ]}
                >
                  {planSummary.statusLabel}
                </Text>
              </View>
            </View>
            {/* Item 120: Who, right after the title -- What/When/Where were already real fields
                on this card; Who was the one genuinely missing from the mock's own breakdown. */}
            {planSummary.who && <Text style={styles.planSummaryLine}>👤 {planSummary.who}</Text>}
            {(planSummary.dateLabel || planSummary.timeLabel) && (
              <Text style={styles.planSummaryLine}>
                📅 {planSummary.dateLabel ?? 'Date not set'}{planSummary.timeLabel ? `  🕖 ${planSummary.timeLabel}` : ''}
              </Text>
            )}
            {planSummary.location && <Text style={styles.planSummaryLine}>📍 {planSummary.location}</Text>}
            {planSummary.partySize != null && <Text style={styles.planSummaryLine}>👥 {planSummary.partySize} people</Text>}
            {planSummary.statusKind === 'confirmed' && (
              <View style={styles.planSummaryActionsRow}>
                {planOrganizerInfo?.isHost && (
                  <TouchableOpacity
                    style={styles.sharePlanCardLink}
                    onPress={goInviteFromAchievementCard}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel="Invite someone to this plan"
                  >
                    <Text style={styles.sharePlanCardLinkText}>👥 Invite</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.sharePlanCardLink}
                  onPress={handleSharePlanCard}
                  disabled={sharingPlanCard}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Share this plan: ${buildOccasionPlanShareCaption(planSummary).replace(/\n/g, ', ')}`}
                >
                  <Text style={styles.sharePlanCardLinkText}>{sharingPlanCard ? 'Creating card…' : '🎉 Share This Plan'}</Text>
                </TouchableOpacity>
                {/* Item 121 ("Business offer acceptance should feel equally tangible"): "Add to
                    Calendar / Get Directions / Get an Uber... should appear immediately" once
                    genuinely booked -- co-located here with Invite/Share rather than buried in
                    the per-offer card further down. */}
                <TouchableOpacity
                  style={styles.sharePlanCardLink}
                  onPress={handleAddToCalendar}
                  disabled={addingToCalendar}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Add this plan to your calendar"
                >
                  <Text style={styles.sharePlanCardLinkText}>{addingToCalendar ? 'Opening…' : '📅 Add to Calendar'}</Text>
                </TouchableOpacity>
                {(planSummary.businessLatitude != null || planSummary.businessAddress) && (
                  <TouchableOpacity
                    style={styles.sharePlanCardLink}
                    onPress={handleGetDirections}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel="Get directions"
                  >
                    <Text style={styles.sharePlanCardLinkText}>🧭 Get Directions</Text>
                  </TouchableOpacity>
                )}
                {planSummary.businessLatitude != null && planSummary.businessLongitude != null && (
                  <TouchableOpacity
                    style={styles.sharePlanCardLink}
                    onPress={handleGetUberForPlan}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel="Get an Uber there"
                  >
                    <Text style={styles.sharePlanCardLinkText}>🚗 Get an Uber</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        )}
        {planSummary && planSummary.statusKind === 'confirmed' && (
          // Off-screen, always-mounted so the ref is ready to capture the
          // moment the user taps Share -- never rendered visibly (view-shot
          // captures this ref directly regardless of on-screen position).
          <View style={styles.hiddenShareCardWrap} pointerEvents="none">
            <OccasionPlanShareCard
              ref={shareCardRef}
              title={planSummary.title}
              dateLabel={planSummary.dateLabel}
              timeLabel={planSummary.timeLabel}
              location={planSummary.location}
              partySize={planSummary.partySize}
            />
          </View>
        )}
        {!!request.addon_type && (
          <View style={styles.groupPlanBanner}>
            <Text style={styles.groupPlanBannerText}>{planAddonIcon(request.addon_type)} {planAddonLabel(request.addon_type)} — part of a bigger plan</Text>
            <TouchableOpacity
              style={styles.groupPlanBannerButton}
              onPress={() => navigation.push('BusinessRequestDetail', { requestId: request.parent_request_id })}
              accessibilityLabel="View the full plan"
              accessibilityRole="button"
            >
              <Text style={styles.groupPlanBannerButtonText}>View the Full Plan →</Text>
            </TouchableOpacity>
          </View>
        )}
        {planChatInfo?.whoForName && myId && request.requester_id !== myId && (
          <View style={styles.occasionContextBanner}>
            <Text style={styles.occasionContextText}>
              {occasionIcon(planChatInfo.occasionType) ?? '🎉'} You're helping plan {planChatInfo.whoForName}'s{' '}
              {(occasionLabel(planChatInfo.occasionType) || 'plan').toLowerCase()}.
            </Text>
          </View>
        )}
        {showReasonBanner && notificationReason && (
          <View style={styles.notificationReasonBanner}>
            <Text style={styles.notificationReasonText}>{notificationReason}</Text>
            <TouchableOpacity
              onPress={() => setShowReasonBanner(false)}
              accessibilityLabel="Dismiss"
              accessibilityRole="button"
              style={styles.notificationReasonDismiss}
            >
              <Text style={styles.notificationReasonDismissText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
        {justSubmitted && (
          <View style={styles.banner}>
            {/* Item 112 follow-up (CLAUDE.md, "take it beyond the
                occasion-selection screen... when the plan is successfully
                created"): only the genuine success case (a real business
                was actually asked) gets the N -> ✨ -> ✓ celebration --
                the duplicate case ("here it is again") and the
                zero-notified case (nothing has actually happened yet,
                still needs a wider-radius retry) aren't real "it's
                happening" moments, so they keep the plain informational
                line only. Applies to every real caller of this screen's
                justSubmitted param (AskBusinessScreen, the Occasion
                wizard's business-destined submit, GroupOccasionPlanScreen's
                "Book It") -- one shared success moment, not three copies. */}
            {!isDuplicate && notifiedCount > 0 && <SuccessAnimation haptic />}
            <Text style={styles.bannerText}>
              {isDuplicate
                ? "You already have an open request just like this — here it is, no need to ask twice."
                : notifiedCount > 0
                ? `We asked ${notifiedCount} nearby business${notifiedCount === 1 ? '' : 'es'} — you'll be notified as offers come in.`
                : `We couldn't find a nearby business to ask within ${priorRadiusMiles} miles — try widening your search.`}
            </Text>
            {!isDuplicate && notifiedCount === 0 && (
              <TouchableOpacity
                style={styles.widerRadiusButton}
                onPress={handleTryWiderRadius}
                accessibilityLabel={`Try a wider radius, ${widerRadiusMiles} miles`}
                accessibilityRole="button"
              >
                <Text style={styles.widerRadiusButtonText}>Try a Wider Radius →</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <Text style={styles.rawText}>{request.raw_text}</Text>
        <Text style={[styles.statusLine, statusCopy.color === 'primary' && { color: colors.primary }]}>{statusCopy.label}</Text>

        {myPendingGroupPlanId && (
          <View style={styles.groupPlanBanner}>
            <Text style={styles.groupPlanBannerText}>👥 Someone wants to make this a group plan with you.</Text>
            <TouchableOpacity
              style={styles.groupPlanBannerButton}
              onPress={() => navigation.navigate('GroupPlan', { proposalId: myPendingGroupPlanId })}
              accessibilityLabel="View group plan invite"
              accessibilityRole="button"
            >
              <Text style={styles.groupPlanBannerButtonText}>View & Respond →</Text>
            </TouchableOpacity>
          </View>
        )}

        {isMergedIntoGroupPlan && (
          <View style={styles.groupPlanBanner}>
            <Text style={styles.groupPlanBannerText}>This request became part of a shared group plan.</Text>
            <TouchableOpacity
              style={styles.groupPlanBannerButton}
              onPress={() => navigation.navigate('GroupPlan', { proposalId: request.superseded_by_group_plan_id })}
              accessibilityLabel="View group plan"
              accessibilityRole="button"
            >
              <Text style={styles.groupPlanBannerButtonText}>View Group Plan →</Text>
            </TouchableOpacity>
          </View>
        )}

        {isGroupPlanRequest && (
          <View style={styles.groupPlanBanner}>
            <Text style={styles.groupPlanBannerText}>👥 This is a shared group plan — everyone in the group confirms offers together.</Text>
            <TouchableOpacity
              style={styles.groupPlanBannerButton}
              onPress={() => navigation.navigate('GroupPlan', { proposalId: request.group_plan_id })}
              accessibilityLabel="View group plan"
              accessibilityRole="button"
            >
              <Text style={styles.groupPlanBannerButtonText}>View Group Plan →</Text>
            </TouchableOpacity>
          </View>
        )}

        {offers.length === 0 ? (
          <View>
            {/* Item 57 ("N mark as product language, but don't overdo it"):
                a small muted mark on this one real, self-contained empty-
                state block -- not the many inline single-line empty texts
                elsewhere in this app that don't read as their own moment. */}
            <NearbyMark size={24} style={{ opacity: 0.3, marginBottom: spacing.xs }} />
            <Text style={styles.emptyText}>No businesses have responded yet.</Text>
            {/* Item 56 ("no dead ends"): the original justSubmitted banner
                only ever offered this retry once, right after submitting,
                and only when notifiedCount was already 0 -- a request that
                genuinely never got any takers (or a revisit via push tap,
                which carries none of the original route.params) had no way
                back to a retry at all. request.status === 'open' matches
                this screen's own existing "still actionable" gate used
                everywhere else on this file. */}
            {!justSubmitted && request.status === 'open' && (
              <TouchableOpacity
                style={styles.widerRadiusButton}
                onPress={handleTryWiderRadius}
                accessibilityLabel={`Try a wider radius, ${widerRadiusMiles} miles`}
                accessibilityRole="button"
              >
                <Text style={styles.widerRadiusButtonText}>Try a Wider Radius →</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <>
          {showComparison && (
            <View style={styles.comparisonHeaderRow}>
              <Text style={styles.comparisonHeaderText}>🔍 Compare Your Options</Text>
              <Text style={styles.comparisonHeaderSubtext}>
                {offeredCount} businesses want to make this happen — ranked by reliability
              </Text>
            </View>
          )}
          {/* Item 124 ("Use animation when something becomes available"): a pending business
              request's own offers are the literal "we found options for you" moment -- each
              card settles into place with a small per-index cascade instead of appearing all at
              once, whether the user is watching live or opened the app from a push. */}
          {displayOffers.map((o, offerIndex) => {
            const stats = partnerStats[o.partner_id];
            const reputationLine = formatPartnerReliabilityLine(stats?.reputation, stats?.responseTime);
            return (
            <StaggeredReveal key={o.id} index={offerIndex} style={styles.offerCard}>
            <View>
              <Text style={styles.offerPartnerName}>{o.brand_partners?.name ?? 'A business'}</Text>
              {/* Item 92 ("Businesses should be able to respond specifically to
                  the occasion", CLAUDE.md): a real, named offer title -- "Special
                  Birthday Offer" -- rendered as its own headline, distinct from
                  the business's own name above it. Null for a plain generic
                  offer with no title, same as it always rendered before. */}
              {o.offer_title ? <Text style={styles.offerTitleHeadline}>{o.offer_title}</Text> : null}
              {reputationLine && (o.status === 'offered' || o.status === 'accepted') ? (
                <Text style={styles.offerReputationLine}>{reputationLine}</Text>
              ) : null}
              {/* Item 121 ("Business offer acceptance should feel equally tangible"): "Offer
                  Accepted ✓ -> details slide into place" -- a brief dip/recover on the whole
                  status-dependent block whenever o.status actually changes (offered -> accepted),
                  the same cause-and-effect confirmation ModeTransition already gives mode/filter
                  switches (Items 114-117), applied here to a single offer card's own real state
                  transition. */}
              <ModeTransition activeKey={o.status}>
              <Text style={styles.offerStatus}>{OFFER_STATUS_COPY[o.status] ?? o.status}</Text>
              {o.status === 'offered' && (
                <>
                  {showComparison && (
                    <Text style={styles.offerTypeLabel}>{OFFER_TYPE_LABELS[o.offer_type] ?? o.offer_type}</Text>
                  )}
                  {o.offer_description ? <Text style={styles.offerDescription}>{o.offer_description}</Text> : null}
                  {/* Item 92: a real included-items checklist, "✓ Private table" /
                      "✓ Birthday dessert" per row -- absent entirely for a plain
                      offer with no items, never a fabricated placeholder list. */}
                  {(o.included_items ?? []).map((item, index) => (
                    <Text key={index} style={styles.offerIncludedItem}>✓ {item}</Text>
                  ))}
                  {o.proposed_time ? <Text style={styles.offerProposedTime}>🕐 {formatProposedTime(o.proposed_time)}</Text> : null}
                  {o.offer_price !== null ? <Text style={styles.offerPrice}>${Number(o.offer_price).toFixed(2)}{o.price_is_per_person ? '/person' : ''}</Text> : null}
                  <OfferMediaPreview path={o.media_path} type={o.media_type} colors={colors} />
                  {showComparison && o.viewed_at ? (
                    <Text style={styles.offerViewedIndicator}>👁 You've seen this</Text>
                  ) : null}
                  {!hasWinner && isGroupPlanRequest && (
                    <TouchableOpacity
                      style={styles.acceptButton}
                      onPress={() => navigation.navigate('GroupPlan', { proposalId: request.group_plan_id })}
                      accessibilityLabel="Confirm this offer with the group"
                      accessibilityRole="button"
                    >
                      <Text style={styles.acceptButtonText}>Confirm With the Group →</Text>
                    </TouchableOpacity>
                  )}
                  {!hasWinner && !isGroupPlanRequest && (
                    <TouchableOpacity
                      style={styles.acceptButton}
                      onPress={() => handleAccept(o.id)}
                      disabled={actingOfferId === o.id}
                      accessibilityLabel={`Accept offer from ${o.brand_partners?.name ?? 'this business'}`}
                      accessibilityRole="button"
                    >
                      {actingOfferId === o.id ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.acceptButtonText}>Accept This Offer</Text>}
                    </TouchableOpacity>
                  )}
                </>
              )}
              {o.status === 'accepted' && (
                <>
                  {o.offer_description ? <Text style={styles.offerDescription}>{o.offer_description}</Text> : null}
                  {(o.included_items ?? []).map((item, index) => (
                    <Text key={index} style={styles.offerIncludedItem}>✓ {item}</Text>
                  ))}
                  {o.proposed_time ? <Text style={styles.offerProposedTime}>🕐 {formatProposedTime(o.proposed_time)}</Text> : null}
                  {o.offer_price !== null ? <Text style={styles.offerPrice}>${Number(o.offer_price).toFixed(2)}{o.price_is_per_person ? '/person' : ''}</Text> : null}
                  <OfferMediaPreview path={o.media_path} type={o.media_type} colors={colors} />
                  {o.brand_partners?.latitude != null && o.brand_partners?.longitude != null && (
                    <TouchableOpacity
                      onPress={() => openUberToDestination({
                        latitude: o.brand_partners.latitude,
                        longitude: o.brand_partners.longitude,
                        nickname: o.brand_partners.name,
                        address: o.brand_partners.address,
                      })}
                      accessibilityLabel="Get an Uber there"
                      accessibilityRole="button"
                    >
                      <Text style={styles.uberLinkText}>🚗 Get an Uber there</Text>
                    </TouchableOpacity>
                  )}
                  {(() => {
                    const payment = o.business_reservations?.[0]?.business_payments?.[0];
                    if (!payment || payment.status === 'not_required') return null;
                    if (payment.status === 'captured') {
                      return <Text style={styles.helperText}>✅ Payment sent to the business.</Text>;
                    }
                    if (payment.status === 'failed') {
                      return (
                        <>
                          <Text style={styles.helperText}>⚠️ Payment didn't go through{payment.failure_reason ? `: ${payment.failure_reason}` : '.'}</Text>
                          <TouchableOpacity
                            style={styles.acceptButton}
                            onPress={() => collectPayment(o.id)}
                            disabled={collectingPayment}
                            accessibilityLabel="Try payment again"
                            accessibilityRole="button"
                          >
                            {collectingPayment ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.acceptButtonText}>Try Payment Again</Text>}
                          </TouchableOpacity>
                        </>
                      );
                    }
                    if (payment.status === 'refunded') {
                      return <Text style={styles.helperText}>↩️ This payment was refunded.</Text>;
                    }
                    // 'pending' -- accept_business_offer() already created this row,
                    // but no PaymentIntent has actually been confirmed yet (the
                    // in-app payment sheet was skipped, cancelled, or failed to load).
                    return (
                      <>
                        <Text style={styles.helperText}>💳 This offer needs a real payment before it's fully confirmed.</Text>
                        <TouchableOpacity
                          style={styles.acceptButton}
                          onPress={() => collectPayment(o.id)}
                          disabled={collectingPayment}
                          accessibilityLabel="Complete payment"
                          accessibilityRole="button"
                        >
                          {collectingPayment ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.acceptButtonText}>Complete Payment</Text>}
                        </TouchableOpacity>
                      </>
                    );
                  })()}
                  <TouchableOpacity
                    style={styles.completeButton}
                    onPress={() => handleComplete(o.id)}
                    disabled={actingOfferId === o.id}
                    accessibilityLabel="Mark this reservation complete"
                    accessibilityRole="button"
                  >
                    {actingOfferId === o.id ? <ActivityIndicator color={colors.primary} size="small" /> : <Text style={styles.completeButtonText}>Mark as Completed</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.cancelReservationButton}
                    onPress={() => handleCancelReservation(o.id)}
                    disabled={actingOfferId === o.id}
                    accessibilityLabel="Cancel this reservation"
                    accessibilityRole="button"
                  >
                    <Text style={styles.cancelReservationButtonText}>Cancel Reservation</Text>
                  </TouchableOpacity>
                </>
              )}
              </ModeTransition>
            </View>
            </StaggeredReveal>
            );
          })}
          </>
        )}

        {/* Item 89 ("Give the occasion a single shared conversation,"
            CLAUDE.md): shown for both a primary and an add-on's own
            screen, same reasoning as the Organizers section right below --
            the chat belongs to the whole plan, not to whichever specific
            request row happens to be on screen. planChatInfo is only
            ever non-null for a real participant (get_plan_chat_info's own
            authorization check), so its presence is the render gate. */}
        {planChatInfo && (
          <TouchableOpacity
            style={styles.groupChatLink}
            onPress={() => navigation.navigate('PlanChat', { businessRequestId: requestId, initialTitle: planChatInfo.title })}
            accessibilityLabel={`Open group chat, ${planChatInfo.participants?.length ?? 0} people`}
            accessibilityRole="button"
          >
            <Text style={styles.groupChatLinkText}>💬 Group Chat ({planChatInfo.participants?.length ?? 0})</Text>
          </TouchableOpacity>
        )}

        {/* Item 88 ("Let multiple people organize the same occasion,"
            CLAUDE.md): shown for both a primary and an add-on's own
            screen -- organizing authority applies plan-wide either way.
            planOrganizerInfo is only ever non-null for someone genuinely
            authorized (the host, or an already-added co-organizer), so its
            mere presence is the render gate -- no separate check needed. */}
        {planOrganizerInfo && (
          <View
            style={styles.groupPlanSection}
            onLayout={(e) => { organizersSectionYRef.current = e.nativeEvent.layout.y; }}
          >
            <Text style={styles.groupPlanSectionTitle}>👥 Organizers</Text>
            <Text style={styles.candidateText}>👑 {planOrganizerInfo.hostName ?? 'Host'} (host)</Text>
            {planOrganizerInfo.organizers.map((o) => (
              <View key={o.id} style={styles.organizerRow}>
                <Text style={styles.candidateText}>🎗️ {o.displayName ?? 'Co-organizer'}</Text>
                {planOrganizerInfo.isHost && (
                  <TouchableOpacity
                    onPress={() => handleRemoveOrganizer(o.id, o.displayName)}
                    disabled={organizerActionBusy}
                    accessibilityLabel={`Remove ${o.displayName ?? 'this person'} as a co-organizer`}
                    accessibilityRole="button"
                  >
                    <Text style={styles.addonRemoveText}>Remove</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}

            {planOrganizerInfo.isHost && !showOrganizers && (
              <TouchableOpacity
                style={styles.inviteSomeoneLink}
                onPress={() => setShowOrganizers(true)}
                accessibilityLabel="Add a co-organizer"
                accessibilityRole="button"
              >
                <Text style={styles.inviteSomeoneLinkText}>+ Add Co-Organizer →</Text>
              </TouchableOpacity>
            )}

            {planOrganizerInfo.isHost && showOrganizers && (
              <>
                <Text style={styles.helperText}>Co-organizers can help find a business, invite people, and manage add-ons like transportation or decorations -- but only you can accept an offer or cancel the plan.</Text>
                {connections
                  .filter((c) => !planOrganizerInfo.organizers.some((o) => o.id === c.id))
                  .map((c) => {
                    const selected = selectedNewOrganizerId === c.id;
                    return (
                      <TouchableOpacity
                        key={c.id}
                        style={[styles.candidateRow, selected && styles.candidateRowSelected]}
                        onPress={() => setSelectedNewOrganizerId(selected ? null : c.id)}
                        accessibilityLabel={`Make ${c.name ?? 'this person'} a co-organizer`}
                        accessibilityRole="button"
                      >
                        <Text style={styles.candidateName}>{selected ? '●' : '○'} {c.name ?? 'Someone you know'}</Text>
                      </TouchableOpacity>
                    );
                  })}
                <TouchableOpacity
                  style={[styles.groupPlanButton, !selectedNewOrganizerId && styles.groupPlanButtonDisabled]}
                  onPress={handleAddOrganizer}
                  disabled={!selectedNewOrganizerId || organizerActionBusy}
                  accessibilityLabel="Confirm add co-organizer"
                  accessibilityRole="button"
                >
                  {organizerActionBusy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.groupPlanButtonText}>Add Co-Organizer →</Text>}
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {!request.addon_type && (
          <View style={styles.groupPlanSection}>
            {/* Item 81 ("One Plan can contain multiple businesses,"
                CLAUDE.md): the real chronological itinerary -- the
                primary plus every live add-on, sorted by whichever time
                is actually known (a manually-set plan_time, else a real
                accepted offer's own proposed_time, else honestly
                "Anytime"). Two entries of the same type (two rides, at
                two different times) each get their own row. */}
            <Text style={styles.groupPlanSectionTitle}>🗺️ Your Plan</Text>
            <Text style={styles.helperText}>{planReadinessLabel}</Text>
            {planTimeline.map((entry) => {
              const busy = addonActionKey === entry.requestId;
              const copy = addonStateCopy(entry.state);
              return (
                <View key={entry.id} style={styles.timelineRow}>
                  <View style={styles.timelineTimeCol}>
                    <Text style={[styles.timelineTimeText, !entry.hasTime && styles.timelineTimeTextMuted]}>{entry.planTimeLabel}</Text>
                  </View>
                  <View style={styles.timelineBody}>
                    <View style={styles.addonRowHeader}>
                      <Text style={styles.candidateName}>{entry.icon} {entry.label}</Text>
                      <Text style={styles.candidateText}>{copy.short}</Text>
                    </View>
                    {entry.businessName && <Text style={styles.candidateText}>with {entry.businessName}</Text>}
                    <View style={styles.addonRowActions}>
                      {entry.kind === 'addon' && (
                        <TouchableOpacity
                          onPress={() => navigation.push('BusinessRequestDetail', { requestId: entry.requestId })}
                          accessibilityLabel={`View ${entry.label}`}
                          accessibilityRole="button"
                        >
                          <Text style={styles.addonActionText}>View →</Text>
                        </TouchableOpacity>
                      )}
                      {canAddAddons && entry.state !== 'confirmed' && (
                        <TouchableOpacity
                          onPress={() => openEditForm(entry)}
                          disabled={busy}
                          accessibilityLabel={`Set a time for ${entry.label}`}
                          accessibilityRole="button"
                        >
                          <Text style={styles.addonActionText}>🕐 {entry.hasTime ? 'Edit Time' : 'Set a Time'}</Text>
                        </TouchableOpacity>
                      )}
                      {entry.kind === 'addon' && entry.canRetry && canAddAddons && (
                        <TouchableOpacity
                          onPress={() => handleRetryEntry(entry)}
                          disabled={busy}
                          accessibilityLabel={`Try again for ${entry.label}`}
                          accessibilityRole="button"
                        >
                          {busy ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.addonActionText}>🔁 Try Again</Text>}
                        </TouchableOpacity>
                      )}
                      {entry.kind === 'addon' && (entry.state === 'pending' || entry.state === 'offered') && (
                        <TouchableOpacity
                          onPress={() => handleRemoveEntry(entry)}
                          disabled={busy}
                          accessibilityLabel={`Remove ${entry.label}`}
                          accessibilityRole="button"
                        >
                          {busy ? <ActivityIndicator size="small" color={colors.textTertiary} /> : <Text style={styles.addonRemoveText}>Remove</Text>}
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                </View>
              );
            })}

            {canAddAddons && (
              <>
                <Text style={[styles.groupPlanSectionTitle, { marginTop: spacing.md }]}>✨ Make it special</Text>
                <Text style={styles.helperText}>Add another business to this plan — a ride, live music, flowers, and more.</Text>
                <View style={styles.chipRow}>
                  {relevantAddonTypes.map((type) => (
                    <TouchableOpacity
                      key={type.key}
                      style={styles.chip}
                      onPress={() => openAddForm(type.key)}
                      accessibilityLabel={`Add ${type.label}`}
                      accessibilityRole="button"
                    >
                      <Text style={styles.chipText}>{type.icon} {type.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {!!timelineForm && (
              <View style={styles.timelineFormCard}>
                <Text style={styles.candidateName}>
                  {timelineForm.mode === 'add' ? `+ Add ${relevantAddonTypes.find((t) => t.key === timelineForm.type)?.label ?? ''}` : '🕐 Set a Time'}
                </Text>
                <TextInput
                  style={styles.timelineFormInput}
                  placeholder="Label (optional) — e.g. Ride home"
                  placeholderTextColor={colors.textTertiary}
                  value={timelineFormLabel}
                  onChangeText={setTimelineFormLabel}
                />
                <TouchableOpacity
                  style={styles.timelineFormTimeButton}
                  onPress={() => setShowTimelineTimePicker(true)}
                  accessibilityLabel="Pick a time"
                  accessibilityRole="button"
                >
                  <Text style={styles.timelineFormTimeButtonText}>
                    🕐 {timelineFormTime ? timelineFormTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Pick a time (optional)'}
                  </Text>
                </TouchableOpacity>
                {showTimelineTimePicker && (
                  <DateTimePicker
                    value={timelineFormTime ?? new Date()}
                    mode="time"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    themeVariant={isDark ? 'dark' : 'light'}
                    onChange={(event, selected) => {
                      setShowTimelineTimePicker(Platform.OS === 'ios');
                      if (selected) setTimelineFormTime(selected);
                    }}
                  />
                )}
                <View style={styles.timelineFormActions}>
                  <TouchableOpacity onPress={closeTimelineForm} accessibilityLabel="Cancel" accessibilityRole="button">
                    <Text style={styles.addonRemoveText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.timelineFormSubmitButton}
                    onPress={submitTimelineForm}
                    disabled={!!addonActionKey}
                    accessibilityLabel={timelineForm.mode === 'add' ? 'Add to plan' : 'Save'}
                    accessibilityRole="button"
                  >
                    {addonActionKey ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.timelineFormSubmitButtonText}>{timelineForm.mode === 'add' ? 'Add' : 'Save'}</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        )}

        {request.status === 'open' && groupPlanCandidates.length > 0 && (
          <View style={styles.groupPlanSection}>
            <Text style={styles.groupPlanSectionTitle}>👥 People you know are also asking for this</Text>
            <Text style={styles.helperText}>Do this together? Everyone you pick has to say yes first — nobody gets added without agreeing.</Text>
            {groupPlanCandidates.map((c) => {
              const selected = selectedCandidateIds.includes(c.id);
              return (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.candidateRow, selected && styles.candidateRowSelected]}
                  onPress={() => toggleGroupPlanCandidate(c.id)}
                  accessibilityLabel={`${selected ? 'Remove' : 'Add'} ${c.requester_display_name ?? 'this person'} to the group plan`}
                  accessibilityRole="button"
                >
                  <Text style={styles.candidateName}>{selected ? '☑' : '☐'} {c.requester_display_name ?? 'Someone you know'}</Text>
                  {c.raw_text ? <Text style={styles.candidateText} numberOfLines={1}>{c.raw_text}</Text> : null}
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              style={[styles.groupPlanButton, selectedCandidateIds.length === 0 && styles.groupPlanButtonDisabled]}
              onPress={handleProposeGroupPlan}
              disabled={selectedCandidateIds.length === 0 || proposingGroupPlan}
              accessibilityLabel="Make this a group plan"
              accessibilityRole="button"
            >
              {proposingGroupPlan ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.groupPlanButtonText}>Make It a Group Plan →</Text>}
            </TouchableOpacity>
          </View>
        )}

        {request.status === 'open' && !isGroupPlanRequest && connections.length > 0 && !showInviteSomeone && (
          <TouchableOpacity
            style={styles.inviteSomeoneLink}
            onPress={() => setShowInviteSomeone(true)}
            accessibilityLabel="Invite someone to this request"
            accessibilityRole="button"
          >
            <Text style={styles.inviteSomeoneLinkText}>👤 Invite Someone →</Text>
          </TouchableOpacity>
        )}

        {request.status === 'open' && !isGroupPlanRequest && showInviteSomeone && (
          <View style={styles.groupPlanSection}>
            <Text style={styles.groupPlanSectionTitle}>👤 Invite Someone</Text>
            {/* "ok do it" (CLAUDE.md): same "✨ People you may want to
                invite" framing GatheringConfirmationScreen already uses for
                its own suggestedInviteeIds -- one convention, not two. */}
            {suggestedInviteeIds && suggestedInviteeIds.length > 0 && (
              <Text style={styles.suggestedInviteeHeader}>
                ✨ People you may want to invite{suggestedInviteeLabel ? ` — ${suggestedInviteeLabel}` : ''}
              </Text>
            )}
            <Text style={styles.helperText}>Bring a friend or match along. They'll have to say yes first — nobody gets added without agreeing.</Text>
            {[...connections]
              .sort((a, b) => (suggestedInviteeIds?.includes(b.id) ? 1 : 0) - (suggestedInviteeIds?.includes(a.id) ? 1 : 0))
              .map((c) => {
              const selected = selectedInviteeIds.includes(c.id);
              const isSuggested = !!suggestedInviteeIds?.includes(c.id);
              return (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.candidateRow, selected && styles.candidateRowSelected]}
                  onPress={() => toggleInviteeSelection(c.id)}
                  accessibilityLabel={`${selected ? 'Remove' : 'Add'} ${c.name ?? 'this person'} to the invite`}
                  accessibilityRole="button"
                >
                  <Text style={styles.candidateName}>{selected ? '☑' : '☐'} {isSuggested ? '🤝 ' : ''}{c.name ?? 'Someone you know'}</Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              style={[styles.groupPlanButton, selectedInviteeIds.length === 0 && styles.groupPlanButtonDisabled]}
              onPress={handleInviteSomeone}
              disabled={selectedInviteeIds.length === 0 || invitingSomeone}
              accessibilityLabel="Send invite"
              accessibilityRole="button"
            >
              {invitingSomeone ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.groupPlanButtonText}>Send Invite →</Text>}
            </TouchableOpacity>
          </View>
        )}

        {request.status === 'open' && (
          <TouchableOpacity onPress={handleCancel} disabled={cancelling} accessibilityLabel="Cancel this request" accessibilityRole="button">
            <Text style={styles.cancelLink}>{cancelling ? 'Cancelling…' : 'Cancel Request'}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
      <OfferOutcomeModal
        visible={!!outcomeModalOfferId}
        offerId={outcomeModalOfferId}
        onClose={() => setOutcomeModalOfferId(null)}
      />
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  banner: { backgroundColor: colors.surfaceElevated, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg },
  bannerText: { ...typography.body, color: colors.textSecondary },
  notificationReasonBanner: {
    flexDirection: 'row', alignItems: 'flex-start', backgroundColor: colors.primaryMuted,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary, padding: spacing.md, marginBottom: spacing.lg,
  },
  notificationReasonText: { flex: 1, color: colors.textPrimary, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  notificationReasonDismiss: { paddingLeft: spacing.sm },
  notificationReasonDismissText: { color: colors.textTertiary, fontSize: 15, fontWeight: '600' },
  widerRadiusButton: { marginTop: spacing.sm, alignSelf: 'flex-start' },
  widerRadiusButtonText: { ...typography.body, color: colors.primary, fontWeight: '700' },
  // Item 90 ("the Plan itself becomes the source of truth" -- CLAUDE.md):
  // the one real, single canonical plan-state block -- every real
  // participant looking at this same request sees the same title/date/
  // time/location/party size/status, instead of piecing it together from
  // raw_text, per-offer cards, and the timeline separately.
  planSummaryCard: {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  planSummaryHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: spacing.xs },
  planSummaryTitle: { ...typography.headline, color: colors.textPrimary, flex: 1, marginRight: spacing.sm },
  // Item 112 follow-up ("the finished plan could have a living header"):
  // wraps the title + its separately-animated CelebrationHeaderIcon.
  planSummaryTitleRow: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: spacing.sm },
  planSummaryTitleIcon: { marginRight: spacing.xs },
  planSummaryStatusPill: { backgroundColor: colors.surface, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  planSummaryStatusPillConfirmed: { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
  planSummaryStatusPillCancelled: { backgroundColor: colors.dangerMuted ?? colors.surface, borderColor: colors.danger },
  // Item 91 ("Add a 'Plan Status'" -- CLAUDE.md): two more real tones for
  // the two new mid-progression states (Option Selected / Booking
  // Pending) -- the same warm-amber tint Item 84's occasion preview
  // banner already established for "in progress, not yet the app's one
  // primary coral action" -- and one for Completed (a past, settled
  // state, not a "look at this" one, so it reads as muted/quiet rather
  // than colored).
  planSummaryStatusPillInProgress: { backgroundColor: 'rgba(230, 168, 46, 0.14)', borderColor: 'rgba(230, 168, 46, 0.4)' },
  planSummaryStatusPillCompleted: { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
  planSummaryStatusText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  planSummaryStatusTextConfirmed: { color: colors.primary },
  planSummaryStatusTextCancelled: { color: colors.danger },
  planSummaryStatusTextInProgress: { color: colors.inProgress },
  planSummaryStatusTextCompleted: { color: colors.textTertiary },
  planSummaryLine: { ...typography.body, color: colors.textSecondary, marginTop: 2 },
  planSummaryActionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.sm },
  sharePlanCardLink: { alignSelf: 'flex-start' },
  sharePlanCardLinkText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  hiddenShareCardWrap: { position: 'absolute', top: -9999, left: -9999, opacity: 0 },
  rawText: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.xs },
  statusLine: { ...typography.caption, color: colors.textTertiary, fontWeight: '600', marginBottom: spacing.lg },
  emptyText: { ...typography.body, color: colors.textSecondary },
  comparisonHeaderRow: { marginBottom: spacing.md },
  comparisonHeaderText: { ...typography.headline, color: colors.textPrimary, marginBottom: 2 },
  comparisonHeaderSubtext: { ...typography.caption, color: colors.textSecondary },
  offerCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.md,
  },
  offerPartnerName: { ...typography.body, color: colors.textPrimary, fontWeight: '700' },
  // Item 92 ("Businesses should be able to respond specifically to the
  // occasion", CLAUDE.md): a real, named offer reads as its own headline
  // -- "Special Birthday Offer" -- distinct from the plain business-name
  // line above it, so the compelling structured response the item asks
  // for actually looks like one, not just more prose.
  offerTitleHeadline: { ...typography.headline, color: colors.textPrimary, marginTop: 2 },
  offerReputationLine: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  offerStatus: { ...typography.caption, color: colors.textTertiary, marginTop: 2, marginBottom: spacing.xs },
  offerTypeLabel: { ...typography.caption, color: colors.primary, fontWeight: '700', marginBottom: spacing.xs },
  offerDescription: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.xs },
  offerIncludedItem: { ...typography.body, color: colors.textPrimary, marginBottom: 2 },
  offerProposedTime: { ...typography.body, color: colors.textPrimary, fontWeight: '600', marginBottom: spacing.xs },
  offerPrice: { ...typography.body, color: colors.textPrimary, fontWeight: '700', marginBottom: spacing.sm },
  offerViewedIndicator: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.sm },
  acceptButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.sm, alignItems: 'center', marginTop: spacing.xs },
  acceptButtonText: { color: '#fff', fontWeight: '700' },
  completeButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.sm, alignItems: 'center', marginTop: spacing.xs },
  completeButtonText: { color: colors.primary, fontWeight: '700' },
  cancelReservationButton: { borderWidth: 1, borderColor: colors.danger, borderRadius: radius.full, paddingVertical: spacing.sm, alignItems: 'center', marginTop: spacing.xs },
  cancelReservationButtonText: { color: colors.danger, fontWeight: '700' },
  cancelLink: { color: colors.textTertiary, fontSize: 14, textAlign: 'center', marginTop: spacing.lg },
  groupPlanBanner: {
    backgroundColor: colors.primaryMuted, borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  // Item 97 ("Invite without revealing the surprise"): a persistent, real
  // "you're helping plan X's Y" line for anyone genuinely invited/added
  // as an organizer -- not just a one-time push they might dismiss. Safe
  // to show unconditionally to a real plan participant: the celebrated
  // person can never become one in the first place when surprise_mode is
  // on (Item 96), and this screen is never reachable by the business side.
  occasionContextBanner: {
    backgroundColor: colors.primaryMuted, borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  occasionContextText: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
  groupPlanBannerText: { ...typography.body, color: colors.textPrimary, marginBottom: spacing.xs },
  groupPlanBannerButton: { alignSelf: 'flex-start' },
  groupPlanBannerButtonText: { ...typography.body, color: colors.primary, fontWeight: '700' },
  inviteSomeoneLink: { marginTop: spacing.lg, alignSelf: 'flex-start' },
  inviteSomeoneLinkText: { ...typography.body, color: colors.primary, fontWeight: '700' },
  groupPlanSection: { marginTop: spacing.lg, marginBottom: spacing.md },
  groupPlanSectionTitle: { ...typography.body, color: colors.textPrimary, fontWeight: '700', marginBottom: 2 },
  groupChatLink: { marginTop: spacing.lg, alignSelf: 'flex-start', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  groupChatLinkText: { ...typography.body, color: colors.textPrimary, fontWeight: '700' },
  // "ok do it": same framing GatheringConfirmationScreen's own
  // suggestedInviteeIds header already uses.
  suggestedInviteeHeader: { ...typography.caption, color: colors.primary, fontWeight: '700', marginBottom: 2 },
  helperText: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm },
  uberLinkText: { ...typography.body, color: colors.primary, fontWeight: '700', marginBottom: spacing.sm },
  candidateRow: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.sm, marginBottom: spacing.xs,
  },
  candidateRowSelected: { borderColor: colors.primary, backgroundColor: colors.primaryMuted },
  candidateName: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
  candidateText: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
  groupPlanButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.sm, alignItems: 'center', marginTop: spacing.sm },
  groupPlanButtonDisabled: { opacity: 0.5 },
  groupPlanButtonText: { color: '#fff', fontWeight: '700' },
  addonRowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  // Item 88 ("Let multiple people organize the same occasion," CLAUDE.md):
  // one line per co-organizer, name + a host-only Remove link -- same
  // spacing/weight as an addon timeline row, no new visual language.
  organizerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  addonRowActions: { flexDirection: 'row', marginTop: spacing.xs, flexWrap: 'wrap' },
  addonActionText: { ...typography.caption, color: colors.primary, fontWeight: '700', marginRight: spacing.md },
  addonRemoveText: { ...typography.caption, color: colors.textTertiary, fontWeight: '700' },
  // Item 81 ("One Plan can contain multiple businesses," CLAUDE.md): the
  // real chronological timeline row -- a fixed-width time column
  // (honestly reading "Anytime" rather than a fabricated time) beside
  // the entry's own icon/label/state/actions.
  timelineRow: {
    flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, padding: spacing.sm, marginBottom: spacing.xs,
  },
  timelineTimeCol: { width: 76, paddingRight: spacing.sm, justifyContent: 'flex-start' },
  timelineTimeText: { ...typography.caption, color: colors.textPrimary, fontWeight: '700' },
  timelineTimeTextMuted: { color: colors.textTertiary, fontWeight: '600' },
  timelineBody: { flex: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.xs },
  chip: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.full,
    paddingVertical: spacing.xs, paddingHorizontal: spacing.md, marginRight: spacing.xs, marginBottom: spacing.xs,
  },
  chipText: { ...typography.caption, color: colors.textPrimary, fontWeight: '600' },
  timelineFormCard: {
    backgroundColor: colors.primaryMuted, borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary,
    padding: spacing.md, marginTop: spacing.sm,
  },
  timelineFormInput: {
    ...typography.body, color: colors.textPrimary, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, marginTop: spacing.sm, backgroundColor: colors.surface,
  },
  timelineFormTimeButton: { marginTop: spacing.sm, alignSelf: 'flex-start' },
  timelineFormTimeButtonText: { ...typography.body, color: colors.primary, fontWeight: '700' },
  timelineFormActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.md },
  timelineFormSubmitButton: {
    backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.xs, paddingHorizontal: spacing.lg,
  },
  timelineFormSubmitButtonText: { color: '#fff', fontWeight: '700' },
});
