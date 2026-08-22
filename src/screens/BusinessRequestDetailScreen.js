import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useStripe, initStripe } from '@stripe/stripe-react-native';
import { getBusinessRequestWithOffers, acceptBusinessOffer, cancelBusinessRequest, completeBusinessReservation, getPartnerAvgResponseTime, getPartnerOfferReputation, formatPartnerReliabilityLine, markBusinessOfferViewed } from '../services/businessFulfillment';
import { getGroupPlanCandidates, proposeGroupPlan } from '../services/groupPlans';
import { recordIntentSelection } from '../services/intentOutcomes';
import { createBusinessPaymentIntent, isStripeConfigured, STRIPE_PUBLISHABLE_KEY } from '../services/stripeConnect';
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


// The consumer-side offer-review/accept screen -- Phase 2 of the Intent
// Layer plan (CLAUDE.md). Reached right after submitting a request
// (AskBusinessScreen) and, later, via a real push notification
// (business_offer_received/business_offer_accepted) when a business
// responds -- no separate "My Requests" list screen was built this pass,
// matching the plan's own "a consumer-side offer-review/accept screen"
// (singular) scope; revisiting a request relies on the push deep link,
// same as this app's established gathering_invite precedent.
export default function BusinessRequestDetailScreen({ navigation, route }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const requestId = route.params?.requestId;
  const justSubmitted = route.params?.justSubmitted ?? false;
  const notifiedCount = route.params?.notifiedCount ?? 0;
  const isDuplicate = route.params?.duplicate ?? false;
  // Finding 4: the original ask's own fields, carried forward so "Try a
  // Wider Radius" can push a fresh, pre-filled AskBusiness instead of
  // sending the user back to a blank form.
  const prefillFields = {
    prefillText: route.params?.prefillText ?? null,
    prefillCategory: route.params?.prefillCategory ?? null,
    prefillPartySize: route.params?.prefillPartySize ?? null,
    prefillBudgetMax: route.params?.prefillBudgetMax ?? null,
    prefillDateWindow: route.params?.prefillDateWindow ?? null,
    prefillSubmissionId: route.params?.prefillSubmissionId ?? null,
    gatheringId: route.params?.gatheringId ?? null,
    gatheringTitle: route.params?.gatheringTitle ?? null,
    gatheringPartySize: route.params?.gatheringPartySize ?? null,
    matchId: route.params?.matchId ?? null,
    matchName: route.params?.matchName ?? null,
  };
  const priorRadiusMiles = route.params?.prefillRadiusMiles ?? 15;
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

  const [request, setRequest] = useState(null);
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [actingOfferId, setActingOfferId] = useState(null);
  const [cancelling, setCancelling] = useState(false);
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

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function handleAccept(offerId) {
    setActingOfferId(offerId);
    try {
      const result = await acceptBusinessOffer(offerId);
      await load();
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
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
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

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        {justSubmitted && (
          <View style={styles.banner}>
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
          <Text style={styles.emptyText}>No businesses have responded yet.</Text>
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
          {displayOffers.map((o) => {
            const stats = partnerStats[o.partner_id];
            const reputationLine = formatPartnerReliabilityLine(stats?.reputation, stats?.responseTime);
            return (
            <View key={o.id} style={styles.offerCard}>
              <Text style={styles.offerPartnerName}>{o.brand_partners?.name ?? 'A business'}</Text>
              {reputationLine && (o.status === 'offered' || o.status === 'accepted') ? (
                <Text style={styles.offerReputationLine}>{reputationLine}</Text>
              ) : null}
              <Text style={styles.offerStatus}>{OFFER_STATUS_COPY[o.status] ?? o.status}</Text>
              {o.status === 'offered' && (
                <>
                  {showComparison && (
                    <Text style={styles.offerTypeLabel}>{OFFER_TYPE_LABELS[o.offer_type] ?? o.offer_type}</Text>
                  )}
                  {o.offer_description ? <Text style={styles.offerDescription}>{o.offer_description}</Text> : null}
                  {o.proposed_time ? <Text style={styles.offerProposedTime}>🕐 {formatProposedTime(o.proposed_time)}</Text> : null}
                  {o.offer_price !== null ? <Text style={styles.offerPrice}>${Number(o.offer_price).toFixed(2)}</Text> : null}
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
                  {o.proposed_time ? <Text style={styles.offerProposedTime}>🕐 {formatProposedTime(o.proposed_time)}</Text> : null}
                  {o.offer_price !== null ? <Text style={styles.offerPrice}>${Number(o.offer_price).toFixed(2)}</Text> : null}
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
                </>
              )}
            </View>
            );
          })}
          </>
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
  widerRadiusButton: { marginTop: spacing.sm, alignSelf: 'flex-start' },
  widerRadiusButtonText: { ...typography.body, color: colors.primary, fontWeight: '700' },
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
  offerReputationLine: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  offerStatus: { ...typography.caption, color: colors.textTertiary, marginTop: 2, marginBottom: spacing.xs },
  offerTypeLabel: { ...typography.caption, color: colors.primary, fontWeight: '700', marginBottom: spacing.xs },
  offerDescription: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.xs },
  offerProposedTime: { ...typography.body, color: colors.textPrimary, fontWeight: '600', marginBottom: spacing.xs },
  offerPrice: { ...typography.body, color: colors.textPrimary, fontWeight: '700', marginBottom: spacing.sm },
  offerViewedIndicator: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.sm },
  acceptButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.sm, alignItems: 'center', marginTop: spacing.xs },
  acceptButtonText: { color: '#fff', fontWeight: '700' },
  completeButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.sm, alignItems: 'center', marginTop: spacing.xs },
  completeButtonText: { color: colors.primary, fontWeight: '700' },
  cancelLink: { color: colors.textTertiary, fontSize: 14, textAlign: 'center', marginTop: spacing.lg },
  groupPlanBanner: {
    backgroundColor: colors.primaryMuted, borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  groupPlanBannerText: { ...typography.body, color: colors.textPrimary, marginBottom: spacing.xs },
  groupPlanBannerButton: { alignSelf: 'flex-start' },
  groupPlanBannerButtonText: { ...typography.body, color: colors.primary, fontWeight: '700' },
  groupPlanSection: { marginTop: spacing.lg, marginBottom: spacing.md },
  groupPlanSectionTitle: { ...typography.body, color: colors.textPrimary, fontWeight: '700', marginBottom: 2 },
  helperText: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm },
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
});
