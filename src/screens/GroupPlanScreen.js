import { recordAcceptBehavior } from '../services/behaviorSignals';
import { useLanguage } from '../context/LanguageContext';
import { categoryName } from '../i18n/categoryNames';
import { canDo, offerLifecycleState } from '../utils/objectLifecycle';
import { presentRecoverableError } from '../utils/recoverableError';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, ActivityIndicator, Alert, TextInput } from 'react-native';
import { NLoader, SuccessAnimation, BookedCelebration } from '../motion';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import {
  getGroupPlanDetail,
  respondToGroupPlan,
  getMyGroupPlanDietary,
  setMyGroupPlanDietary,
  setGroupPlanBudget,
  confirmGroupPlan,
  cancelGroupPlan,
  leaveGroupPlan,
  removeGroupPlanParticipant,
  confirmGroupPlanOffer,
} from '../services/groupPlans';
import { submitSocialOffer, respondToSocialOffer, markSocialOfferViewed } from '../services/socialOffers';
import { recordIntentSelection } from '../services/intentOutcomes';
import DietaryPicker from '../components/DietaryPicker';
import LoadErrorState from '../components/LoadErrorState';
import CancellationReasonSheet from '../components/CancellationReasonSheet';
import StaggeredReveal from '../components/StaggeredReveal';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
import { offerPriceLabel } from '../utils/outcomeDisplay';
import { moneyLabel } from '../utils/outcomeDisplay';
import { isNotFound } from '../utils/notFound';
import UnavailableState from '../components/UnavailableState';

// Display labels by stored status, read through ui.groupPlan (status values stay canonical).
const PARTICIPANT_STATUS_KEYS = ['invited', 'accepted', 'declined', 'left'];

const OFFER_STATUS_KEYS = ['pending', 'offered', 'accepted', 'declined', 'withdrawn', 'expired', 'cancelled', 'completed'];

// "The Offer System" Phase 4 (see CLAUDE.md's own plan, Decision 3):
// mirrors the commercial-offer lifecycle's own refined shape (Decision
// 6), not a second invented one.
const SOCIAL_OFFER_STATUS_KEYS = ['offered', 'accepted', 'declined', 'withdrawn', 'expired', 'cancelled'];
const statusCopy = (t, group, keys, status) => (keys.includes(status) ? t(`ui.groupPlan.${group}.${status}`) : status);

// "Nearby V3/V4" plan, Phase D (see CLAUDE.md) -- a real "group plan" is
// group-owned, not initiator-owned: every accepted participant sees this
// same screen and the same real state, not a filtered view of it. User-
// facing copy deliberately never says "merge" or "proposal" -- Phase D's
// own locked rule 12 ("group plan" / "do this together", never internal
// terminology on screen).
export default function GroupPlanScreen({ navigation, route }) {
  const { t, language } = useLanguage();
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const proposalId = route.params?.proposalId;

  const [myId, setMyId] = useState(null);
  const [reasonAsk, setReasonAsk] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // Item 139: the object was deleted or is no longer visible (often opened from a push or link): say so, never retry.
  const [unavailable, setUnavailable] = useState(false);
  const [acting, setActing] = useState(false);
  const [budgetInput, setBudgetInput] = useState('');
  const [excludeIds, setExcludeIds] = useState([]);
  const [myDietary, setMyDietary] = useState([]);
  const [socialOfferInput, setSocialOfferInput] = useState('');
  // Success state (per the Nearby Motion Language): confirming the plan and locking
  // in the group's reservation (CLAUDE.md's own disclosed "group-plan-confirm" gap)
  // used to be a silent state re-render -- now a brief, self-clearing celebration,
  // distinct text per moment since they're two genuinely different real events.
  const [successBanner, setSuccessBanner] = useState(null); // null | 'plan' | 'reservation'
  const successBannerTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(successBannerTimerRef.current), []);

  function flashSuccess(kind) {
    setSuccessBanner(kind);
    clearTimeout(successBannerTimerRef.current);
    successBannerTimerRef.current = setTimeout(() => setSuccessBanner(null), 3200);
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData?.session?.user?.id ?? null;
      setMyId(uid);
      const result = await getGroupPlanDetail(proposalId);
      setDetail(result);
      setExcludeIds([]);
      if (result.proposal.agreed_budget_max !== null) {
        setBudgetInput(String(result.proposal.agreed_budget_max));
      }
      if (result.proposal.category === 'Foodie') {
        getMyGroupPlanDietary(proposalId).then(setMyDietary).catch(() => {});
      }
      setLoadError(false);

      // Phase 4: a real, honest read receipt -- only the request's own
      // requester (the group plan's initiator) is who this column
      // actually tracks, same authority model as respond_to_social_
      // offer() itself.
      if (result.proposal.initiator_id === uid) {
        result.socialOffers
          .filter((o) => o.status === 'offered' && !o.viewed_at)
          .forEach((o) => markSocialOfferViewed(o.id));
      }
    } catch (e) {
      if (isNotFound(e)) setUnavailable(true);
      else setLoadError(true);
    }
    setLoading(false);
  }, [proposalId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Was focus-only (§F, Aug 15 2026 connectivity audit) — a participant
  // actively viewing this screen while another participant confirmed/
  // left/got excluded saw stale state (a stale "N of M confirmed" count
  // in particular) until they navigated away and back. Every other
  // multi-party live-coordination screen in this app already has a real
  // realtime channel; this was the one exception. A whole-screen re-fetch
  // on any event is the simplest correct approach for a screen this
  // low-frequency — no per-row optimistic patching attempted.
  useEffect(() => {
    if (!proposalId) return undefined;
    const channel = supabase
      .channel(`group_plan:${proposalId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_plan_proposals', filter: `id=eq.${proposalId}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_plan_participants', filter: `proposal_id=eq.${proposalId}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_plan_offer_confirmations', filter: `proposal_id=eq.${proposalId}` }, () => load())
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [proposalId, load]);

  async function runAction(fn, onSuccess) {
    setActing(true);
    try {
      const result = await fn();
      await load();
      if (onSuccess) onSuccess(result);
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => runAction(fn, onSuccess) });
    }
    setActing(false);
  }

  function handleAccept() {
    runAction(() => respondToGroupPlan(proposalId, true));
  }

  function handleDecline() {
    Alert.alert(t('ui.groupPlan.sayYouCantMakeIt'), t('ui.groupPlan.theOrganizerWillSeeYou'), [
      { text: t('ui.groupPlan.neverMind'), style: 'cancel' },
      { text: t('ui.groupPlan.cantMakeIt2'), style: 'destructive', onPress: () => runAction(() => respondToGroupPlan(proposalId, false)) },
    ]);
  }

  function handleLeave() {
    // A confirmed plan has offers this person may have confirmed; the server removes exactly those (nobody else's).
    const confirmed = proposal?.status === 'confirmed';
    Alert.alert(
      t('ui.groupPlan.leaveThisGroupPlan'),
      confirmed
        ? t('ui.groupPlan.leaveThisPlanTheOffers')
        : t('ui.groupPlan.youCanAlwaysStartYour'),
      [
        { text: t('ui.groupPlan.neverMind'), style: 'cancel' },
        { text: t('ui.groupPlan.leave'), style: 'destructive', onPress: () => runAction(() => leaveGroupPlan(proposalId)) },
      ],
    );
  }

  function handleSetBudget() {
    const trimmed = budgetInput.trim();
    const value = trimmed.length === 0 ? null : Number(trimmed);
    if (trimmed.length > 0 && (Number.isNaN(value) || value < 0)) {
      Alert.alert(t('ui.groupPlan.realNumberNeeded'), t('ui.groupPlan.enterAWholeDollarAmount'));
      return;
    }
    runAction(() => setGroupPlanBudget(proposalId, value));
  }

  function toggleExclude(userId) {
    setExcludeIds((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
  }

  // Closes the disclosed gap named in CLAUDE.md's Group Plans sections:
  // "Continue without" only stages an exclusion for the next Confirm tap
  // -- this removes someone right now, without forcing the initiator to
  // confirm before they're ready to.
  function handleRemove(userId, name) {
    Alert.alert(
      t('ui.groupPlan.remove', { name: name ?? 'this person' }),
      t('ui.groupPlan.theyllBeToldTheyreNo'),
      [
        { text: t('ui.groupPlan.neverMind'), style: 'cancel' },
        {
          text: t('ui.groupPlan.remove2'),
          style: 'destructive',
          onPress: () => runAction(() => removeGroupPlanParticipant(proposalId, userId)),
        },
      ]
    );
  }

  function handleConfirm() {
    const label = excludeIds.length > 0 ? t('ui.groupPlan.confirmWithoutOfThem', { length: excludeIds.length }) : t('ui.groupPlan.everyoneInGetsAReal');
    Alert.alert(t('ui.groupPlan.confirmThisGroupPlan'), label, [
      { text: t('ui.groupPlan.neverMind'), style: 'cancel' },
      {
        text: t('ui.groupPlan.confirm'),
        onPress: () => runAction(
          () => confirmGroupPlan(proposalId, excludeIds),
          // Wave 2B of the full-system acceptance audit (see
          // PRODUCT_AUDIT/ACCEPTANCE_AUDIT_PROGRESS.md) found the whole
          // Group Plan funnel wrote zero rows to intent_outcomes -- a
          // group plan reaching the real business marketplace was
          // invisible to Market Validation's own dashboard. This records
          // it the same way HomeScreen's own "ask nearby businesses
          // fresh" fallback already does (resultType: 'created_new' --
          // a new business_requests row was genuinely just created).
          // No submissionId: there's no single originating intent
          // submission for a group plan (it's formed from several
          // participants' own separate asks), so this is honestly
          // recorded as unlinked rather than attributed to one.
          (result) => {
            flashSuccess('plan');
            recordIntentSelection({
              rawText: null,
              category: proposal.category,
              dateWindow: proposal.date,
              resultType: 'created_new',
              resultId: result?.requestId ?? null,
              resultTitle: t('ui.groupPlan.groupPlan2', { category: categoryName(proposal.category, language) }),
            });
          }
        ),
      },
    ]);
  }

  function handleCancel() {
    Alert.alert(t('ui.groupPlan.cancelThisGroupPlan'), t('ui.groupPlan.everyoneKeepsTheirOwnIndividual'), [
      { text: t('ui.groupPlan.neverMind'), style: 'cancel' },
      { text: t('ui.groupPlan.cancelPlan'), style: 'destructive', onPress: () => runAction(async () => {
        await cancelGroupPlan(proposalId);
        setReasonAsk({ entityType: 'group_plan', entityId: proposalId, role: 'host' });
      }) },
    ]);
  }

  function handleConfirmOffer(offerId) {
    Alert.alert(t('ui.groupPlan.confirmThisOfferForThe'), t('ui.groupPlan.onceEveryoneConfirmsTheReservation'), [
      { text: t('ui.groupPlan.neverMind'), style: 'cancel' },
      {
        text: t('ui.groupPlan.confirm'),
        onPress: () => runAction(
          () => confirmGroupPlanOffer(proposalId, offerId),
          // Same Wave 2B gap as handleConfirm above -- this is the actual
          // "10/10 success case" for the whole feature (a group plan
          // that genuinely turned into a real reservation), and it was
          // completely invisible to the outcome-tracking loop. Only
          // recorded once every participant has actually confirmed
          // (allConfirmed) -- an interim "N of M confirmed" call isn't
          // an outcome yet, it's still in progress.
          (result) => {
            // Item 95: my own confirmation is a deliberate act (private ranking signal, never a profile edit).
            const confirmedOffer = offers.find((o) => o.id === offerId);
            if (result) recordAcceptBehavior(confirmedOffer?.request_id ?? offerId, proposal.category);
            if (!result?.allConfirmed) return;
            flashSuccess('reservation');
            const offer = offers.find((o) => o.id === offerId);
            recordIntentSelection({
              rawText: null,
              category: proposal.category,
              dateWindow: proposal.date,
              resultType: 'business_offer',
              resultId: offerId,
              resultTitle: offer?.brand_partners?.name
                ? t('ui.groupPlan.groupPlan3', { name: offer.brand_partners.name })
                : t('ui.groupPlan.groupPlan2', { category: categoryName(proposal.category, language) }),
            });
          }
        ),
      },
    ]);
  }

  // "The Offer System" Phase 4 (see CLAUDE.md's own plan, Decision 3):
  // the general primitive re-validates eligibility server-side on every
  // call regardless of what the client shows, but the client still only
  // ever offers the action to a confirmed, non-initiator participant --
  // never a stranger, and never the initiator on their own request.
  function handleSubmitSocialOffer() {
    const trimmed = socialOfferInput.trim();
    if (!trimmed) {
      Alert.alert(t('ui.groupPlan.sayWhatYouCanOffer'), t('ui.groupPlan.eGICanDrive'));
      return;
    }
    runAction(
      () => submitSocialOffer(proposal.resulting_request_id, trimmed),
      () => setSocialOfferInput('')
    );
  }

  function handleRespondSocialOffer(offerId, accept) {
    runAction(() => respondToSocialOffer(offerId, accept));
  }

  if (loading && !detail) {
    return (
      <SafeAreaView style={styles.container}>
        <NLoader fullScreen={false} />
      </SafeAreaView>
    );
  }

  if (unavailable) {
    return <SafeAreaView style={styles.container}><UnavailableState navigation={navigation} /></SafeAreaView>;
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadErrorState message={t('ui.groupPlan.couldntLoadThisGroupPlan')} onRetry={load} />
      </SafeAreaView>
    );
  }

  if (!detail) return null;

  const { proposal, participants, offers, confirmations, socialOffers } = detail;
  // Optimistic: the picker reflects the tap immediately; a failed save reverts to what the server has.
  function handleDietaryChange(next) {
    const previous = myDietary;
    setMyDietary(next);
    setMyGroupPlanDietary(proposalId, next).catch(() => {
      setMyDietary(previous);
      Alert.alert(t('ui.groupPlan.couldNotSave'), t('ui.groupPlan.yourDietaryNeedsWereNot'));
    });
  }
  const isInitiator = proposal.initiator_id === myId;
  const myParticipant = participants.find((p) => p.user_id === myId);
  const acceptedParticipants = participants.filter((p) => p.status === 'accepted');
  const totalPartySize = acceptedParticipants.reduce((sum, p) => sum + p.party_size + p.guest_count, 0);
  const budgetRangeLine =
    proposal.proposed_budget_min != null && proposal.proposed_budget_max != null
      ? proposal.proposed_budget_min === proposal.proposed_budget_max
        ? `${moneyLabel(proposal.proposed_budget_min)}/person`
        : `${moneyLabel(proposal.proposed_budget_min)}–${moneyLabel(proposal.proposed_budget_max)}/person`
      : null;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        {/* Item 122 ("Don't overanimate the business experience"): both of these are business
            TRANSACTION confirmations (a group's business offer/reservation locking in), not an
            occasion-creation moment -- tone="business" for a fast, professional settle rather
            than the full celebratory production. */}
        {successBanner === 'plan' && <SuccessAnimation haptic text={t('ui.groupPlan.planConfirmed')} tone="business" />}
        {successBanner === 'reservation' && <BookedCelebration haptic title={t('ui.requestDetail.youreBooked')} />}
        <Text style={styles.title}>{t('ui.groupPlan.groupPlan', { category: categoryName(proposal.category, language) })}</Text>
        <Text style={styles.statusLine}>
          {proposal.status === 'pending' && t('ui.groupPlan.decidingTogether')}
          {/* "Locked In," not "Confirmed" -- the roster/budget is locked and
              a real request is genuinely out, but nothing about the actual
              business side (an offer, let alone a reservation) has happened
              yet. "Confirmed" is reserved for a real business_reservations
              row further down this same screen and on PlanCard's own
              controlled vocabulary -- reusing it here read as the same
              fact at two very different stages (Aug 23 2026 P1 fix,
              CLAUDE.md). */}
          {proposal.status === 'confirmed' && t('ui.groupPlan.lockedInARealRequest')}
          {proposal.status === 'cancelled' && t('ui.groupPlan.cancelled')}
          {proposal.status === 'expired' && t('ui.groupPlan.expiredNobodyConfirmedInTime')}
        </Text>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLine}>👥 {t('ui.groupPlan.peopleInSoFar', { count: totalPartySize })}</Text>
          {budgetRangeLine && <Text style={styles.summaryLine}>{t('ui.groupPlan.groupsComfortableRange', { budgetRangeLine: budgetRangeLine })}</Text>}
          <Text style={styles.summaryLine}>
            {proposal.agreed_budget_max != null ? t('ui.groupPlan.agreedBudgetPerson', { moneyLabel: moneyLabel(proposal.agreed_budget_max) }) : t('ui.groupPlan.noAgreedBudgetYet')}
          </Text>
          {proposal.date && <Text style={styles.summaryLine}>📅 {proposal.date}</Text>}
        </View>

        <Text style={styles.sectionHeader}>{t('ui.groupPlan.whosIn')}</Text>
        {participants.map((p) => (
          <View key={p.id} style={styles.participantRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.participantName}>
                {p.profiles?.display_name ?? t('ui.groupPlan.someone')}{p.user_id === proposal.initiator_id ? t('ui.groupPlan.organizer') : ''}
              </Text>
              <Text style={styles.participantStatus}>{statusCopy(t, 'participantStatus', PARTICIPANT_STATUS_KEYS, p.status)}</Text>
            </View>
            {isInitiator && canDo('group_plan', proposal.status, 'manage') && p.status === 'accepted' && p.user_id !== myId && (
              <TouchableOpacity
                onPress={() => toggleExclude(p.user_id)}
                accessibilityLabel={excludeIds.includes(p.user_id) ? t('ui.groupPlan.includeAgainA11y', { name: p.profiles?.display_name ?? 'this person' }) : t('ui.groupPlan.continueWithoutA11y', { name: p.profiles?.display_name ?? 'this person' })}
                accessibilityRole="button"
              >
                <Text style={excludeIds.includes(p.user_id) ? styles.excludedTag : styles.excludeLink}>
                  {excludeIds.includes(p.user_id) ? t('ui.groupPlan.excludedTapToUndo') : t('ui.groupPlan.continueWithout')}
                </Text>
              </TouchableOpacity>
            )}
            {isInitiator && canDo('group_plan', proposal.status, 'manage') && (p.status === 'accepted' || p.status === 'invited') && p.user_id !== myId && (
              <TouchableOpacity
                onPress={() => handleRemove(p.user_id, p.profiles?.display_name)}
                accessibilityLabel={t('ui.groupPlan.removeFromTheGroupPlanA11y', { name: p.profiles?.display_name ?? 'this person' })}
                accessibilityRole="button"
              >
                <Text style={styles.removeLink}>{t('ui.groupPlan.remove2')}</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}

        {proposal.category === 'Foodie' && canDo('group_plan', proposal.status, 'dietary') && canDo('group_participant', myParticipant?.status, 'dietary') && (
          <DietaryPicker
            selected={myDietary}
            onChange={handleDietaryChange}
            note={t('ui.groupPlan.onlyYouSeeYourPicks')}
          />
        )}

        {canDo('group_plan', proposal.status, 'respond') && canDo('group_participant', myParticipant?.status, 'join') && (
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.primaryButton} onPress={handleAccept} disabled={acting} accessibilityLabel={t('ui.groupPlan.joinThisGroupPlanA11y')} accessibilityRole="button">
              {acting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.primaryButtonText}>{t('ui.groupPlan.joinSharedRequest')}</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={handleDecline} disabled={acting} accessibilityLabel={t('ui.groupPlan.declineThisGroupPlanA11y')} accessibilityRole="button">
              <Text style={styles.declineLink}>{t('ui.groupPlan.cantMakeIt')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {isInitiator && canDo('group_plan', proposal.status, 'manage') && (
          <View style={styles.organizerSection}>
            <Text style={styles.sectionHeader}>{t('ui.groupPlan.setTheBudget')}</Text>
            <Text style={styles.helperText}>{t('ui.groupPlan.pickOneRealNumberThe')}{budgetRangeLine ? t('ui.groupPlan.within', { budgetRangeLine: budgetRangeLine }) : ''}.</Text>
            <View style={styles.budgetRow}>
              <Text style={styles.budgetDollar}>$</Text>
              <TextInput
                style={styles.budgetInput}
                value={budgetInput}
                onChangeText={setBudgetInput}
                placeholder="e.g. 50"
                placeholderTextColor={colors.textTertiary}
                keyboardType="number-pad"
              />
              <TouchableOpacity style={styles.budgetSaveButton} onPress={handleSetBudget} disabled={acting} accessibilityLabel={t('ui.groupPlan.saveAgreedBudgetA11y')} accessibilityRole="button">
                <Text style={styles.budgetSaveButtonText}>{t('ui.groupPlan.save')}</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.primaryButton, { marginTop: spacing.lg }]}
              onPress={handleConfirm}
              disabled={acting}
              accessibilityLabel={t('ui.groupPlan.confirmGroupPlanAndSendA11y')}
              accessibilityRole="button"
            >
              {acting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.primaryButtonText}>{t('ui.groupPlan.confirmAskNearbyBusinesses')}</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={handleCancel} disabled={acting} accessibilityLabel={t('ui.groupPlan.cancelThisGroupPlanA11y')} accessibilityRole="button">
              <Text style={styles.declineLink}>{t('ui.groupPlan.cancelGroupPlan')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {canDo('group_plan', proposal.status, 'offers') && (
          <>
            <Text style={styles.sectionHeader}>{t('ui.groupPlan.offers')}</Text>
            {offers.length === 0 ? (
              <Text style={styles.helperText}>{t('ui.groupPlan.noBusinessesHaveRespondedYet')}</Text>
            ) : (
              offers.map((o, offerIndex) => {
                const confirmedForThisOffer = confirmations.filter((c) => c.offer_id === o.id);
                const iConfirmed = confirmedForThisOffer.some((c) => c.user_id === myId);
                const amActiveParticipant = canDo('group_participant', myParticipant?.status, 'confirm_offer');
                return (
                  // Item 124 ("Use animation when something becomes available"): the group's own
                  // "we found options" moment -- each offer settles into place with a small
                  // per-index cascade rather than appearing all at once.
                  <StaggeredReveal key={o.id} index={offerIndex} style={styles.offerCard}>
                  <View>
                    <Text style={styles.offerPartnerName}>{o.brand_partners?.name ?? t('ui.groupPlan.aBusiness')}</Text>
                    <Text style={styles.offerStatus}>{offerLifecycleState(o) === 'expired' ? t('ui.groupPlan.thisOfferHasExpired') : statusCopy(t, 'offerStatus', OFFER_STATUS_KEYS, o.status)}</Text>
                    {o.offer_description ? <Text style={styles.offerDescription}>{o.offer_description}</Text> : null}
                    {offerPriceLabel(o.offer_price, o.price_is_per_person) ? <Text style={styles.offerPrice}>{offerPriceLabel(o.offer_price, o.price_is_per_person)}</Text> : null}
                    {canDo('offer', offerLifecycleState(o), 'accept') && amActiveParticipant && (
                      <>
                        <Text style={styles.confirmCountLine}>{confirmedForThisOffer.length} of {acceptedParticipants.length} confirmed</Text>
                        <TouchableOpacity
                          style={[styles.acceptButton, iConfirmed && styles.acceptButtonDisabled]}
                          onPress={() => handleConfirmOffer(o.id)}
                          disabled={acting || iConfirmed}
                          accessibilityLabel={t('ui.groupPlan.confirmThisOfferForTheA11y')}
                          accessibilityRole="button"
                        >
                          <Text style={styles.acceptButtonText}>{iConfirmed ? t('ui.groupPlan.youveConfirmed') : t('ui.groupPlan.confirmForTheGroup')}</Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                  </StaggeredReveal>
                );
              })
            )}

            <Text style={styles.sectionHeader}>{t('ui.groupPlan.socialOffers')}</Text>
            <Text style={styles.helperText}>{t('ui.groupPlan.anyoneInTheGroupCan')}</Text>
            {socialOffers.length === 0 ? (
              <Text style={styles.helperText}>{t('ui.groupPlan.noOneHasOfferedTo')}</Text>
            ) : (
              socialOffers.map((o, socialOfferIndex) => (
                <StaggeredReveal key={o.id} index={socialOfferIndex} style={styles.offerCard}>
                <View>
                  <Text style={styles.offerPartnerName}>{o.profiles?.display_name ?? t('ui.groupPlan.someone')}</Text>
                  <Text style={styles.offerStatus}>{statusCopy(t, 'socialOfferStatus', SOCIAL_OFFER_STATUS_KEYS, o.status)}</Text>
                  <Text style={styles.offerDescription}>{o.offer_description}</Text>
                  {isInitiator && canDo('offer', offerLifecycleState(o), 'accept') && (
                    <View style={styles.socialOfferActionRow}>
                      <TouchableOpacity
                        style={[styles.acceptButton, { flex: 1 }]}
                        onPress={() => handleRespondSocialOffer(o.id, true)}
                        disabled={acting}
                        accessibilityLabel={t('ui.groupPlan.acceptSOfferA11y', { name: o.profiles?.display_name ?? 'this' })}
                        accessibilityRole="button"
                      >
                        <Text style={styles.acceptButtonText}>{t('ui.groupPlan.accept')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleRespondSocialOffer(o.id, false)}
                        disabled={acting}
                        accessibilityLabel={t('ui.groupPlan.declineSOfferA11y', { name: o.profiles?.display_name ?? 'this' })}
                        accessibilityRole="button"
                        style={styles.socialOfferDeclineButton}
                      >
                        <Text style={styles.declineButtonText}>{t('ui.groupPlan.decline')}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
                </StaggeredReveal>
              ))
            )}
            {canDo('group_participant', myParticipant?.status, 'social_offer') && !isInitiator && !socialOffers.some((o) => o.offerer_id === myId) && (
              <View style={styles.socialOfferForm}>
                <TextInput
                  style={styles.socialOfferInput}
                  value={socialOfferInput}
                  onChangeText={setSocialOfferInput}
                  placeholder={t('ui.groupPlan.eGICanDrive2')}
                  placeholderTextColor={colors.textTertiary}
                  multiline
                  accessibilityLabel={t('ui.groupPlan.whatCanYouOfferA11y')}
                />
                <TouchableOpacity
                  style={styles.socialOfferSubmitButton}
                  onPress={handleSubmitSocialOffer}
                  disabled={acting}
                  accessibilityLabel={t('ui.groupPlan.submitSocialOfferA11y')}
                  accessibilityRole="button"
                >
                  {acting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.acceptButtonText}>{t('ui.groupPlan.offerToHelp')}</Text>}
                </TouchableOpacity>
              </View>
            )}

          </>
        )}

        {/* One Leave control for every state that allows it (pending or confirmed); the server does the cleanup. */}
        {canDo('group_plan', proposal.status, 'leave') && canDo('group_participant', myParticipant?.status, 'leave') && !isInitiator && (
          <TouchableOpacity onPress={handleLeave} disabled={acting} accessibilityLabel={t('ui.groupPlan.leaveThisGroupPlanA11y')} accessibilityRole="button">
            <Text style={styles.declineLink}>{t('ui.groupPlan.leaveGroupPlan')}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
      <CancellationReasonSheet ask={reasonAsk} onClose={() => setReasonAsk(null)} />
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  title: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.xs },
  statusLine: { ...typography.caption, color: colors.textTertiary, fontWeight: '600', marginBottom: spacing.lg },
  summaryCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  summaryLine: { ...typography.body, color: colors.textSecondary, marginBottom: 2 },
  sectionHeader: { ...typography.caption, color: colors.textTertiary, fontWeight: '700', textTransform: 'uppercase', marginBottom: spacing.sm, marginTop: spacing.md },
  participantRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.sm, marginBottom: spacing.xs,
  },
  participantName: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
  participantStatus: { ...typography.caption, color: colors.textTertiary, marginTop: 1 },
  excludeLink: { ...typography.caption, color: colors.textTertiary, textDecorationLine: 'underline' },
  removeLink: { ...typography.caption, color: colors.danger, textDecorationLine: 'underline', marginTop: 4 },
  excludedTag: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  actionRow: { marginTop: spacing.lg },
  primaryButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.sm, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontWeight: '700' },
  declineLink: { color: colors.textTertiary, fontSize: 14, textAlign: 'center', marginTop: spacing.md },
  organizerSection: { marginTop: spacing.lg },
  helperText: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm },
  budgetRow: { flexDirection: 'row', alignItems: 'center' },
  budgetDollar: { ...typography.body, color: colors.textPrimary, fontWeight: '700', marginRight: 4 },
  budgetInput: {
    flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, color: colors.textPrimary, marginRight: spacing.sm,
  },
  budgetSaveButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  budgetSaveButtonText: { color: colors.primary, fontWeight: '700' },
  offerCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.md,
  },
  offerPartnerName: { ...typography.body, color: colors.textPrimary, fontWeight: '700' },
  offerStatus: { ...typography.caption, color: colors.textTertiary, marginTop: 2, marginBottom: spacing.xs },
  offerDescription: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.xs },
  offerPrice: { ...typography.body, color: colors.textPrimary, fontWeight: '700', marginBottom: spacing.sm },
  confirmCountLine: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xs },
  acceptButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.sm, alignItems: 'center', marginTop: spacing.xs },
  acceptButtonDisabled: { opacity: 0.5 },
  acceptButtonText: { color: '#fff', fontWeight: '700' },
  socialOfferActionRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  socialOfferDeclineButton: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.full, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
  declineButtonText: { color: colors.textSecondary, fontWeight: '700' },
  socialOfferForm: { marginTop: spacing.sm, marginBottom: spacing.md },
  socialOfferInput: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.sm, color: colors.textPrimary, minHeight: 60, textAlignVertical: 'top', marginBottom: spacing.sm,
  },
  socialOfferSubmitButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.sm, alignItems: 'center' },
});
