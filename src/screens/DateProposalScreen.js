import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, ActivityIndicator, Alert, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import {
  getLatestDateProposal,
  getMatchBusinessRequest,
  proposeDate,
  respondToDateProposal,
  withdrawDateProposal,
  searchNearbyForPlan,
  createBusinessRequestForMatch,
} from '../services/dateProposals';
import { getAcceptedOfferForRequest, getOpenOfferCounts } from '../services/businessFulfillment';
import LoadErrorState from '../components/LoadErrorState';
import AcceptedBusinessOfferCard from '../components/AcceptedBusinessOfferCard';
import PlanCompletionRow from '../components/PlanCompletionRow';
import { getMatchPlanCompletion, formatPlaceStatusLabel } from '../utils/planCompletion';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

const TERMINAL_STATUS_COPY = {
  declined: "Didn't work out that time",
  withdrawn: 'Withdrawn',
};

// Discover/People-Friends parity plan, item 4: a quick "what do you want
// to do" entry point instead of a blank text box, using the same 26-tag
// vocabulary AskBusinessScreen's own category chips already use (via
// `prefillCategory`) so a pick here lands on an already-selected chip
// there. "Something fun"/"Surprise me" intentionally map to no single tag
// (category: null) -- AskBusinessScreen already treats a null category as
// a real, well-supported "send to any nearby business" request, not a
// missing value.
const PLAN_QUICK_CATEGORIES = [
  { key: 'dinner', emoji: '🍽️', label: 'Dinner', category: 'Foodie', planText: 'Dinner sometime?' },
  { key: 'coffee', emoji: '☕', label: 'Coffee', category: 'Coffee', planText: 'Coffee sometime?' },
  { key: 'fitness', emoji: '🏃', label: 'Fitness', category: 'Fitness', planText: 'Want to work out together?' },
  { key: 'fun', emoji: '🎨', label: 'Something fun', category: null, planText: 'Want to do something fun?' },
  { key: 'music', emoji: '🎵', label: 'Music', category: 'Music', planText: 'Want to check out some music?' },
  { key: 'outdoors', emoji: '🌴', label: 'Outdoors', category: 'Outdoors', planText: 'Want to get outside?' },
  { key: 'surprise', emoji: '✨', label: 'Surprise me', category: null, planText: 'Surprise me — you pick!' },
];

// "The Offer System" Phase 5 (see CLAUDE.md's own plan, Decision 4). The
// one real screen for the locked Match -> Proposal -> Other person
// accepts -> Dating Experience -> Business Request shape -- renders
// whatever's currently true for this match right now, same "one screen,
// not a filtered view" philosophy GroupPlanScreen.js already established
// for its own multi-person plan. Match != Date is enforced server-side
// (propose_date/respond_to_date_proposal), not just by which button this
// screen happens to show -- a stale client can never bypass it.
export default function DateProposalScreen({ navigation, route }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const matchId = route.params?.matchId;
  const matchName = route.params?.matchName ?? 'your match';

  const [myId, setMyId] = useState(null);
  const [isRomanticMatch, setIsRomanticMatch] = useState(true);
  const [proposal, setProposal] = useState(null);
  const [businessRequest, setBusinessRequest] = useState(null);
  const [acceptedOffer, setAcceptedOffer] = useState(null);
  const [placeOfferCounts, setPlaceOfferCounts] = useState({ pendingCount: 0, offeredCount: 0 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [planText, setPlanText] = useState('');
  // Discover/People-Friends parity plan, item 4: which quick-category chip
  // (if any) the proposer tapped -- also now persisted server-side on the
  // proposal itself (date_proposals.category, external UX critique reply
  // item 4, 2026-09-10) precisely so the OTHER person's device (which
  // never had this local state) can still prefill "Find Somewhere to Go"
  // correctly. This local copy remains the live, editable source of truth
  // while composing a new proposal.
  const [selectedCategory, setSelectedCategory] = useState(null);
  // External UX critique reply, item 4 (CLAUDE.md, 2026-09-10): which
  // quick-category chip is currently "active" (drives whether "Find
  // something nearby" shows at all) -- distinct from selectedCategory
  // since two chips ("Something fun"/"Surprise me") both use category:
  // null but are still real, distinct active selections.
  const [activeChipKey, setActiveChipKey] = useState(null);
  const [searchingNearby, setSearchingNearby] = useState(false);
  const [nearbyResults, setNearbyResults] = useState(null);
  // The real business_availability posting the proposer chose from real
  // search results, if any -- carried into proposeDate() so the plan is
  // tied to an actual place, not just a category. Never fabricated: only
  // ever set from a genuine searchNearbyForPlan() result the user tapped.
  const [selectedAvailabilityId, setSelectedAvailabilityId] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoadError(false);
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData?.session?.user?.id;
      setMyId(uid ?? null);

      // Same derivation ChatScreen.js/MatchesScreen.js already use --
      // needed here only for the one romantic-flavored string below
      // (AcceptedBusinessOfferCard's kicker); everything else on this
      // screen is already match-type-agnostic.
      const { data: matchRow } = await supabase
        .from('matches')
        .select('source_gathering_id, source_friendship_id')
        .eq('id', matchId)
        .single();
      setIsRomanticMatch(!matchRow?.source_gathering_id && !matchRow?.source_friendship_id);

      const latest = await getLatestDateProposal(matchId);
      setProposal(latest);

      if (latest?.status === 'accepted') {
        const request = await getMatchBusinessRequest(matchId);
        setBusinessRequest(request);
        // Gap #2 (CLAUDE.md, "vision doc describes a fully merged
        // gathering/date <-> business UX"): render an accepted offer's
        // own details inline -- business, time, what they offered --
        // instead of just a "View Request" button off to the side.
        if (request) {
          const offer = await getAcceptedOfferForRequest(request.id);
          setAcceptedOffer(offer);
          // Real "N businesses found" / "N offers, choose one" sub-state
          // (CLAUDE.md, Aug 30 2026) -- both match participants can
          // legitimately see pending/offered rows on a match-sourced
          // request (unlike a gathering attendee's narrower policy).
          setPlaceOfferCounts(offer ? { pendingCount: 0, offeredCount: 0 } : await getOpenOfferCounts(request.id));
        } else {
          setAcceptedOffer(null);
          setPlaceOfferCounts({ pendingCount: 0, offeredCount: 0 });
        }
      } else {
        setBusinessRequest(null);
        setAcceptedOffer(null);
        setPlaceOfferCounts({ pendingCount: 0, offeredCount: 0 });
      }
    } catch (e) {
      console.error('DateProposalScreen load failed', e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handlePropose() {
    if (!planText.trim()) {
      Alert.alert('Tell them what you have in mind', 'A few words about the plan.');
      return;
    }
    setSubmitting(true);
    try {
      await proposeDate(matchId, planText.trim(), selectedAvailabilityId, selectedCategory);
      setPlanText('');
      setSelectedCategory(null);
      setActiveChipKey(null);
      setNearbyResults(null);
      setSelectedAvailabilityId(null);
      await load();
    } catch (e) {
      Alert.alert('Something went wrong', e.message);
    }
    setSubmitting(false);
  }

  // External UX critique reply, item 4 (CLAUDE.md, 2026-09-10): finds real
  // nearby businesses/offers matching the active category -- read-only,
  // contacts no business, matching Home's own "browsing is free" intent-
  // box precedent. category is intentionally null for "Something fun"/
  // "Surprise me" -- a real broad browse, not a missing filter.
  async function handleFindNearby() {
    setSearchingNearby(true);
    setNearbyResults(null);
    try {
      const results = await searchNearbyForPlan(selectedCategory);
      setNearbyResults(results);
    } catch (e) {
      Alert.alert('Something went wrong', e.message);
    }
    setSearchingNearby(false);
  }

  function handleChooseNearby(result) {
    const chip = PLAN_QUICK_CATEGORIES.find((qc) => qc.key === activeChipKey);
    const label = chip ? chip.label : 'Plan';
    setPlanText(`${label} at ${result.partner_name}${result.title ? ` — ${result.title}` : ''}`);
    setSelectedAvailabilityId(result.id);
    setNearbyResults(null);
  }

  // External UX critique reply, item 4: when the proposer already found
  // and chose a specific real place, accepting the plan should mean the
  // plan is created around that place immediately -- "invite person ->
  // plan created," not a second manual "Find Somewhere to Go" search. Any
  // failure here (location permission denied, the place no longer fits by
  // now) degrades honestly: the plan is still accepted either way, and
  // the existing "Find Somewhere to Go ->" manual button still renders
  // below once load() reflects that no businessRequest exists yet.
  async function handleRespond(accept) {
    setSubmitting(true);
    try {
      await respondToDateProposal(proposal.id, accept);
      if (accept && proposal?.availability_id) {
        try {
          await createBusinessRequestForMatch({
            matchId,
            text: proposal.plan_text,
            category: proposal.category,
          });
        } catch (e) {
          console.error('auto-create business request for accepted plan failed', e);
        }
      }
      await load();
    } catch (e) {
      Alert.alert('Something went wrong', e.message);
    }
    setSubmitting(false);
  }

  function handleWithdraw() {
    Alert.alert('Withdraw this plan?', `${matchName} will no longer see it.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Withdraw',
        style: 'destructive',
        onPress: async () => {
          setSubmitting(true);
          try {
            await withdrawDateProposal(proposal.id);
            await load();
          } catch (e) {
            Alert.alert('Something went wrong', e.message);
          }
          setSubmitting(false);
        },
      },
    ]);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator style={{ marginTop: spacing.xxl }} color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadErrorState message="Couldn't load this plan." onRetry={load} />
      </SafeAreaView>
    );
  }

  const isProposer = proposal && myId && proposal.proposed_by === myId;
  const showProposeForm = !proposal || proposal.status === 'declined' || proposal.status === 'withdrawn';
  const planCompletion = getMatchPlanCompletion({
    proposalStatus: proposal?.status ?? null,
    businessRequest,
    acceptedOffer,
  });
  const planPlaceLabels = {
    done: formatPlaceStatusLabel({ place: 'done', venueName: acceptedOffer?.brand_partners?.name ?? null }),
    pending: formatPlaceStatusLabel({ place: 'pending', ...placeOfferCounts }),
    todo: 'Find a place',
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <Text style={styles.heading}>Plan Something Together</Text>
          <Text style={styles.subtitle}>
            Propose a plan with {matchName} -- once they say yes, Nearby can ask real nearby businesses to help make it happen.
          </Text>

          {/* Persistent, computed People/Time/Place status (CLAUDE.md, Aug
              29 2026) -- this is the same real completion state Matches'
              own list row shows, so a plan tracked here never reads
              differently depending on which screen it's viewed from. */}
          <PlanCompletionRow
            people={planCompletion.people}
            time={planCompletion.time}
            place={planCompletion.place}
            placeLabels={planPlaceLabels}
            onPlacePress={
              acceptedOffer || businessRequest
                ? () => navigation.navigate('BusinessRequestDetail', { requestId: businessRequest.id })
                : proposal?.status === 'accepted'
                ? () => navigation.navigate('AskBusiness', { matchId, matchName, prefillCategory: proposal?.category ?? selectedCategory })
                : undefined
            }
            style={{ marginBottom: spacing.lg }}
          />

          {proposal && TERMINAL_STATUS_COPY[proposal.status] && (
            <View style={styles.priorPlanCard}>
              <Text style={styles.priorPlanLabel}>Last plan: {TERMINAL_STATUS_COPY[proposal.status]}</Text>
              <Text style={styles.priorPlanText}>"{proposal.plan_text}"</Text>
            </View>
          )}

          {proposal && proposal.status === 'proposed' && (
            <View style={styles.planCard}>
              <Text style={styles.planCardLabel}>{isProposer ? `You proposed` : `${matchName} proposed`}</Text>
              <Text style={styles.planCardText}>"{proposal.plan_text}"</Text>
              {isProposer ? (
                <>
                  <Text style={styles.waitingText}>Waiting for {matchName} to respond.</Text>
                  <TouchableOpacity style={styles.withdrawButton} onPress={handleWithdraw} disabled={submitting} accessibilityLabel="Withdraw this plan" accessibilityRole="button">
                    <Text style={styles.withdrawButtonText}>Withdraw</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <View style={styles.respondRow}>
                  <TouchableOpacity
                    style={[styles.respondButton, styles.acceptButton]}
                    onPress={() => handleRespond(true)}
                    disabled={submitting}
                    accessibilityLabel="Accept this plan"
                    accessibilityRole="button"
                  >
                    {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.acceptButtonText}>I'm In</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.respondButton, styles.declineButton]}
                    onPress={() => handleRespond(false)}
                    disabled={submitting}
                    accessibilityLabel="Decline this plan"
                    accessibilityRole="button"
                  >
                    <Text style={styles.declineButtonText}>Not This Time</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {proposal && proposal.status === 'accepted' && (
            <View style={styles.acceptedCard}>
              <Text style={styles.acceptedTitle}>🎉 It's a plan!</Text>
              <Text style={styles.planCardText}>"{proposal.plan_text}"</Text>
              {businessRequest && acceptedOffer ? (
                // Gap #2: the merged "your date is set" view -- the real
                // accepted offer's own venue/time/what-they-offered,
                // inline, not just a link off to BusinessRequestDetail.
                // Shared with GatheringDetailScreen's own Gap #1 rendering
                // of the exact same fact via AcceptedBusinessOfferCard
                // (convergence pass P1 follow-up) -- one component, not
                // two hand-copied blocks.
                <AcceptedBusinessOfferCard
                  offer={acceptedOffer}
                  kicker={isRomanticMatch ? '❤️ Your date is set' : '🎉 Plan confirmed'}
                  bordered={false}
                  onViewRequest={() => navigation.navigate('BusinessRequestDetail', { requestId: businessRequest.id })}
                />
              ) : businessRequest ? (
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={() => navigation.navigate('BusinessRequestDetail', { requestId: businessRequest.id })}
                  accessibilityLabel="View your business request"
                  accessibilityRole="button"
                >
                  <Text style={styles.primaryButtonText}>View Request →</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={() => navigation.navigate('AskBusiness', { matchId, matchName, prefillCategory: proposal?.category ?? selectedCategory })}
                  accessibilityLabel="Find somewhere to go"
                  accessibilityRole="button"
                >
                  <Text style={styles.primaryButtonText}>Find Somewhere to Go →</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {showProposeForm && (
            <>
              <Text style={styles.label}>What do you want to do?</Text>
              <View style={styles.quickCategoryRow}>
                {PLAN_QUICK_CATEGORIES.map((qc) => {
                  const selected = activeChipKey === qc.key;
                  return (
                    <TouchableOpacity
                      key={qc.key}
                      style={[styles.quickCategoryChip, selected && styles.quickCategoryChipSelected]}
                      onPress={() => {
                        setSelectedCategory(qc.category);
                        setPlanText(qc.planText);
                        setActiveChipKey(qc.key);
                        setNearbyResults(null);
                        setSelectedAvailabilityId(null);
                      }}
                      accessibilityLabel={qc.label}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <Text style={styles.quickCategoryEmoji}>{qc.emoji}</Text>
                      <Text style={[styles.quickCategoryLabel, selected && styles.quickCategoryLabelSelected]}>{qc.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* External UX critique reply, item 4: the real "find a real
                  place before inviting" step -- shows once a chip is
                  active, searches real live supply, and never fabricates a
                  result. Choosing one composes planText from the real
                  posting and carries its id through to propose_date(). */}
              {activeChipKey && (
                <View style={{ marginBottom: spacing.md }}>
                  <TouchableOpacity
                    style={styles.findNearbyButton}
                    onPress={handleFindNearby}
                    disabled={searchingNearby}
                    accessibilityLabel="Find something nearby"
                    accessibilityRole="button"
                  >
                    {searchingNearby ? (
                      <ActivityIndicator color={colors.primary} />
                    ) : (
                      <Text style={styles.findNearbyButtonText}>🔎 Find something nearby</Text>
                    )}
                  </TouchableOpacity>

                  {searchingNearby && (
                    <Text style={styles.nearbyEmptyText}>Finding availability…</Text>
                  )}

                  {nearbyResults && nearbyResults.length === 0 && (
                    <Text style={styles.nearbyEmptyText}>
                      No real nearby options right now — you can still send a text invite below.
                    </Text>
                  )}

                  {nearbyResults && nearbyResults.length > 0 && (
                    <View style={styles.nearbyResultsList}>
                      {nearbyResults.map((result) => (
                        <TouchableOpacity
                          key={result.id}
                          style={[styles.nearbyResultCard, selectedAvailabilityId === result.id && styles.nearbyResultCardSelected]}
                          onPress={() => handleChooseNearby(result)}
                          accessibilityLabel={`Choose ${result.partner_name}`}
                          accessibilityRole="button"
                        >
                          <Text style={styles.nearbyResultTitle}>{result.partner_name}</Text>
                          {!!result.title && <Text style={styles.nearbyResultSubtitle}>{result.title}</Text>}
                          <Text style={styles.nearbyResultMeta}>
                            {[
                              result.offer_type,
                              result.price != null ? `$${result.price}` : null,
                              result.distance_miles != null ? `${result.distance_miles.toFixed(1)} mi` : null,
                              result.remaining_capacity != null ? `${result.remaining_capacity} spots left` : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              )}

              <Text style={styles.label}>Or say it your way</Text>
              <TextInput
                style={styles.textArea}
                placeholder="Dinner Friday around 7?"
                placeholderTextColor={colors.textTertiary}
                value={planText}
                onChangeText={(text) => {
                  setPlanText(text);
                  setSelectedCategory(null);
                  setActiveChipKey(null);
                  setNearbyResults(null);
                  setSelectedAvailabilityId(null);
                }}
                multiline
                accessibilityLabel="What do you have in mind?"
              />
              <TouchableOpacity
                style={[styles.primaryButton, (submitting || !planText.trim()) && styles.primaryButtonDisabled]}
                onPress={handlePropose}
                disabled={submitting || !planText.trim()}
                accessibilityLabel="Propose this plan"
                accessibilityRole="button"
              >
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Propose Plan</Text>}
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  heading: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.xs },
  subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg },
  label: { ...typography.caption, color: colors.textTertiary, fontWeight: '700', marginBottom: spacing.xs, marginTop: spacing.md },
  quickCategoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.xs },
  quickCategoryChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.full,
    paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  quickCategoryChipSelected: { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
  quickCategoryEmoji: { fontSize: 14 },
  quickCategoryLabel: { ...typography.small, color: colors.textSecondary },
  quickCategoryLabelSelected: { color: colors.primary, fontWeight: '600' },
  textArea: {
    ...typography.body, color: colors.textPrimary, backgroundColor: colors.surface,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, minHeight: 90, textAlignVertical: 'top',
  },
  findNearbyButton: {
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.primary,
    paddingVertical: spacing.sm, alignItems: 'center', backgroundColor: colors.primaryMuted,
    marginBottom: spacing.sm,
  },
  findNearbyButtonText: { ...typography.body, color: colors.primary, fontWeight: '700' },
  nearbyEmptyText: { ...typography.caption, color: colors.textTertiary, fontStyle: 'italic' },
  nearbyResultsList: { gap: spacing.xs },
  nearbyResultCard: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.sm,
  },
  nearbyResultCardSelected: { borderColor: colors.primary, borderWidth: 1.5, backgroundColor: colors.primaryMuted },
  nearbyResultTitle: { ...typography.body, color: colors.textPrimary, fontWeight: '700' },
  nearbyResultSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  nearbyResultMeta: { ...typography.small, color: colors.textTertiary, marginTop: 2 },
  priorPlanCard: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  priorPlanLabel: { ...typography.caption, color: colors.textTertiary, fontWeight: '700', marginBottom: spacing.xs },
  priorPlanText: { ...typography.body, color: colors.textSecondary, fontStyle: 'italic' },
  planCard: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  planCardLabel: { ...typography.caption, color: colors.textTertiary, fontWeight: '700', marginBottom: spacing.xs },
  planCardText: { ...typography.body, color: colors.textPrimary, fontStyle: 'italic', marginBottom: spacing.sm },
  waitingText: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm },
  respondRow: { flexDirection: 'row', marginTop: spacing.sm },
  respondButton: { flex: 1, borderRadius: radius.full, paddingVertical: spacing.md, alignItems: 'center' },
  acceptButton: { backgroundColor: colors.primary, marginRight: spacing.sm },
  acceptButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  declineButton: { backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border },
  declineButtonText: { color: colors.textSecondary, fontWeight: '700', fontSize: 15 },
  withdrawButton: { alignSelf: 'flex-start' },
  withdrawButtonText: { ...typography.caption, color: colors.danger, fontWeight: '700' },
  acceptedCard: {
    backgroundColor: colors.primaryMuted, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.primary,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  acceptedTitle: { ...typography.body, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.xs },
  primaryButton: {
    backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.md,
    alignItems: 'center', marginTop: spacing.md,
  },
  primaryButtonDisabled: { opacity: 0.5 },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
