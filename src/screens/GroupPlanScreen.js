import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, ActivityIndicator, Alert, TextInput } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import {
  getGroupPlanDetail,
  respondToGroupPlan,
  setGroupPlanBudget,
  confirmGroupPlan,
  cancelGroupPlan,
  leaveGroupPlan,
  removeGroupPlanParticipant,
  confirmGroupPlanOffer,
} from '../services/groupPlans';
import { submitSocialOffer, respondToSocialOffer, markSocialOfferViewed } from '../services/socialOffers';
import { recordIntentSelection } from '../services/intentOutcomes';
import LoadErrorState from '../components/LoadErrorState';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

const PARTICIPANT_STATUS_COPY = {
  invited: 'Invited — waiting for a response',
  accepted: 'In',
  declined: "Can't make it",
  left: 'Left the group',
};

const OFFER_STATUS_COPY = {
  pending: 'Waiting for a response',
  offered: 'Made an offer',
  accepted: 'Accepted — reservation confirmed',
  declined: "Can't help with this one",
  expired: 'No longer available',
  cancelled: 'Cancelled',
  completed: 'Completed',
};

// "The Offer System" Phase 4 (see CLAUDE.md's own plan, Decision 3):
// mirrors the commercial-offer lifecycle's own refined shape (Decision
// 6), not a second invented one.
const SOCIAL_OFFER_STATUS_COPY = {
  offered: 'Offered',
  accepted: 'Accepted',
  declined: "Didn't work out",
  withdrawn: 'Withdrawn',
  expired: 'No longer available',
  cancelled: 'Cancelled',
};

// "Nearby V3/V4" plan, Phase D (see CLAUDE.md) -- a real "group plan" is
// group-owned, not initiator-owned: every accepted participant sees this
// same screen and the same real state, not a filtered view of it. User-
// facing copy deliberately never says "merge" or "proposal" -- Phase D's
// own locked rule 12 ("group plan" / "do this together", never internal
// terminology on screen).
export default function GroupPlanScreen({ navigation, route }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const proposalId = route.params?.proposalId;

  const [myId, setMyId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [acting, setActing] = useState(false);
  const [budgetInput, setBudgetInput] = useState('');
  const [excludeIds, setExcludeIds] = useState([]);
  const [socialOfferInput, setSocialOfferInput] = useState('');

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
      setLoadError(true);
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
      Alert.alert('Error', e.message);
    }
    setActing(false);
  }

  function handleAccept() {
    runAction(() => respondToGroupPlan(proposalId, true));
  }

  function handleDecline() {
    Alert.alert('Say you can\'t make it?', 'The organizer will see you declined.', [
      { text: 'Never mind', style: 'cancel' },
      { text: "Can't Make It", style: 'destructive', onPress: () => runAction(() => respondToGroupPlan(proposalId, false)) },
    ]);
  }

  function handleLeave() {
    Alert.alert('Leave this group plan?', 'You can always start your own request again later.', [
      { text: 'Never mind', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => runAction(() => leaveGroupPlan(proposalId)) },
    ]);
  }

  function handleSetBudget() {
    const trimmed = budgetInput.trim();
    const value = trimmed.length === 0 ? null : Number(trimmed);
    if (trimmed.length > 0 && (Number.isNaN(value) || value < 0)) {
      Alert.alert('Real number needed', 'Enter a whole dollar amount, or leave it blank.');
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
      `Remove ${name ?? 'this person'}?`,
      "They'll be told they're no longer part of this group plan. You can keep waiting on everyone else.",
      [
        { text: 'Never mind', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => runAction(() => removeGroupPlanParticipant(proposalId, userId)),
        },
      ]
    );
  }

  function handleConfirm() {
    const label = excludeIds.length > 0 ? `Confirm without ${excludeIds.length} of them?` : 'Everyone in gets a real request sent to nearby businesses.';
    Alert.alert('Confirm this group plan?', label, [
      { text: 'Never mind', style: 'cancel' },
      {
        text: 'Confirm',
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
          (result) => recordIntentSelection({
            rawText: null,
            category: proposal.category,
            dateWindow: proposal.date,
            resultType: 'created_new',
            resultId: result?.requestId ?? null,
            resultTitle: `Group plan — ${proposal.category}`,
          })
        ),
      },
    ]);
  }

  function handleCancel() {
    Alert.alert('Cancel this group plan?', 'Everyone keeps their own individual request exactly as it was.', [
      { text: 'Never mind', style: 'cancel' },
      { text: 'Cancel Plan', style: 'destructive', onPress: () => runAction(() => cancelGroupPlan(proposalId)) },
    ]);
  }

  function handleConfirmOffer(offerId) {
    Alert.alert('Confirm this offer for the group?', 'Once everyone confirms, the reservation locks in.', [
      { text: 'Never mind', style: 'cancel' },
      {
        text: 'Confirm',
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
            if (!result?.allConfirmed) return;
            const offer = offers.find((o) => o.id === offerId);
            recordIntentSelection({
              rawText: null,
              category: proposal.category,
              dateWindow: proposal.date,
              resultType: 'business_offer',
              resultId: offerId,
              resultTitle: offer?.brand_partners?.name
                ? `${offer.brand_partners.name} — group plan`
                : `Group plan — ${proposal.category}`,
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
      Alert.alert('Say what you can offer', 'e.g. "I can drive" or "I can host at my place."');
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
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadErrorState message="Couldn't load this group plan." onRetry={load} />
      </SafeAreaView>
    );
  }

  if (!detail) return null;

  const { proposal, participants, offers, confirmations, socialOffers } = detail;
  const isInitiator = proposal.initiator_id === myId;
  const myParticipant = participants.find((p) => p.user_id === myId);
  const acceptedParticipants = participants.filter((p) => p.status === 'accepted');
  const totalPartySize = acceptedParticipants.reduce((sum, p) => sum + p.party_size + p.guest_count, 0);
  const budgetRangeLine =
    proposal.proposed_budget_min !== null && proposal.proposed_budget_max !== null
      ? proposal.proposed_budget_min === proposal.proposed_budget_max
        ? `$${proposal.proposed_budget_min}/person`
        : `$${proposal.proposed_budget_min}–$${proposal.proposed_budget_max}/person`
      : null;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.title}>{proposal.category} — Group Plan</Text>
        <Text style={styles.statusLine}>
          {proposal.status === 'pending' && 'Deciding together'}
          {proposal.status === 'confirmed' && 'Confirmed — a real request is out to nearby businesses'}
          {proposal.status === 'cancelled' && 'Cancelled'}
          {proposal.status === 'expired' && 'Expired — nobody confirmed in time'}
        </Text>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLine}>👥 {totalPartySize} {totalPartySize === 1 ? 'person' : 'people'} in so far</Text>
          {budgetRangeLine && <Text style={styles.summaryLine}>💰 Group's comfortable range: {budgetRangeLine}</Text>}
          <Text style={styles.summaryLine}>
            {proposal.agreed_budget_max !== null ? `Agreed budget: $${proposal.agreed_budget_max}/person` : 'No agreed budget yet'}
          </Text>
          {proposal.date && <Text style={styles.summaryLine}>📅 {proposal.date}</Text>}
        </View>

        <Text style={styles.sectionHeader}>Who's in</Text>
        {participants.map((p) => (
          <View key={p.id} style={styles.participantRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.participantName}>
                {p.profiles?.display_name ?? 'Someone'}{p.user_id === proposal.initiator_id ? ' (organizer)' : ''}
              </Text>
              <Text style={styles.participantStatus}>{PARTICIPANT_STATUS_COPY[p.status] ?? p.status}</Text>
            </View>
            {isInitiator && proposal.status === 'pending' && p.status === 'accepted' && p.user_id !== myId && (
              <TouchableOpacity
                onPress={() => toggleExclude(p.user_id)}
                accessibilityLabel={excludeIds.includes(p.user_id) ? `Include ${p.profiles?.display_name ?? 'this person'} again` : `Continue without ${p.profiles?.display_name ?? 'this person'}`}
                accessibilityRole="button"
              >
                <Text style={excludeIds.includes(p.user_id) ? styles.excludedTag : styles.excludeLink}>
                  {excludeIds.includes(p.user_id) ? 'Excluded — tap to undo' : 'Continue without'}
                </Text>
              </TouchableOpacity>
            )}
            {isInitiator && proposal.status === 'pending' && (p.status === 'accepted' || p.status === 'invited') && p.user_id !== myId && (
              <TouchableOpacity
                onPress={() => handleRemove(p.user_id, p.profiles?.display_name)}
                accessibilityLabel={`Remove ${p.profiles?.display_name ?? 'this person'} from the group plan now`}
                accessibilityRole="button"
              >
                <Text style={styles.removeLink}>Remove</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}

        {proposal.status === 'pending' && myParticipant?.status === 'invited' && (
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.primaryButton} onPress={handleAccept} disabled={acting} accessibilityLabel="Join this group plan" accessibilityRole="button">
              {acting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.primaryButtonText}>Join Shared Request</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={handleDecline} disabled={acting} accessibilityLabel="Decline this group plan" accessibilityRole="button">
              <Text style={styles.declineLink}>Can't make it</Text>
            </TouchableOpacity>
          </View>
        )}

        {proposal.status === 'pending' && !isInitiator && myParticipant?.status === 'accepted' && (
          <TouchableOpacity onPress={handleLeave} disabled={acting} accessibilityLabel="Leave this group plan" accessibilityRole="button">
            <Text style={styles.declineLink}>Leave Group Plan</Text>
          </TouchableOpacity>
        )}

        {proposal.status === 'pending' && isInitiator && (
          <View style={styles.organizerSection}>
            <Text style={styles.sectionHeader}>Set the budget</Text>
            <Text style={styles.helperText}>Pick one real number the whole group can agree on{budgetRangeLine ? ` (within ${budgetRangeLine})` : ''}.</Text>
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
              <TouchableOpacity style={styles.budgetSaveButton} onPress={handleSetBudget} disabled={acting} accessibilityLabel="Save agreed budget" accessibilityRole="button">
                <Text style={styles.budgetSaveButtonText}>Save</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.primaryButton, { marginTop: spacing.lg }]}
              onPress={handleConfirm}
              disabled={acting}
              accessibilityLabel="Confirm group plan and send to businesses"
              accessibilityRole="button"
            >
              {acting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.primaryButtonText}>Confirm & Ask Nearby Businesses</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={handleCancel} disabled={acting} accessibilityLabel="Cancel this group plan" accessibilityRole="button">
              <Text style={styles.declineLink}>Cancel Group Plan</Text>
            </TouchableOpacity>
          </View>
        )}

        {proposal.status === 'confirmed' && (
          <>
            <Text style={styles.sectionHeader}>Offers</Text>
            {offers.length === 0 ? (
              <Text style={styles.helperText}>No businesses have responded yet.</Text>
            ) : (
              offers.map((o) => {
                const confirmedForThisOffer = confirmations.filter((c) => c.offer_id === o.id);
                const iConfirmed = confirmedForThisOffer.some((c) => c.user_id === myId);
                const amActiveParticipant = myParticipant?.status === 'accepted';
                return (
                  <View key={o.id} style={styles.offerCard}>
                    <Text style={styles.offerPartnerName}>{o.brand_partners?.name ?? 'A business'}</Text>
                    <Text style={styles.offerStatus}>{OFFER_STATUS_COPY[o.status] ?? o.status}</Text>
                    {o.offer_description ? <Text style={styles.offerDescription}>{o.offer_description}</Text> : null}
                    {o.offer_price !== null ? <Text style={styles.offerPrice}>${Number(o.offer_price).toFixed(2)}</Text> : null}
                    {o.status === 'offered' && amActiveParticipant && (
                      <>
                        <Text style={styles.confirmCountLine}>{confirmedForThisOffer.length} of {acceptedParticipants.length} confirmed</Text>
                        <TouchableOpacity
                          style={[styles.acceptButton, iConfirmed && styles.acceptButtonDisabled]}
                          onPress={() => handleConfirmOffer(o.id)}
                          disabled={acting || iConfirmed}
                          accessibilityLabel="Confirm this offer for the group"
                          accessibilityRole="button"
                        >
                          <Text style={styles.acceptButtonText}>{iConfirmed ? "You've confirmed" : 'Confirm for the Group'}</Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                );
              })
            )}

            <Text style={styles.sectionHeader}>Social Offers</Text>
            <Text style={styles.helperText}>Anyone in the group can offer to help make this happen — "I'll drive," "I'll host."</Text>
            {socialOffers.length === 0 ? (
              <Text style={styles.helperText}>No one has offered to help yet.</Text>
            ) : (
              socialOffers.map((o) => (
                <View key={o.id} style={styles.offerCard}>
                  <Text style={styles.offerPartnerName}>{o.profiles?.display_name ?? 'Someone'}</Text>
                  <Text style={styles.offerStatus}>{SOCIAL_OFFER_STATUS_COPY[o.status] ?? o.status}</Text>
                  <Text style={styles.offerDescription}>{o.offer_description}</Text>
                  {isInitiator && o.status === 'offered' && (
                    <View style={styles.socialOfferActionRow}>
                      <TouchableOpacity
                        style={[styles.acceptButton, { flex: 1 }]}
                        onPress={() => handleRespondSocialOffer(o.id, true)}
                        disabled={acting}
                        accessibilityLabel={`Accept ${o.profiles?.display_name ?? 'this'}'s offer`}
                        accessibilityRole="button"
                      >
                        <Text style={styles.acceptButtonText}>Accept</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleRespondSocialOffer(o.id, false)}
                        disabled={acting}
                        accessibilityLabel={`Decline ${o.profiles?.display_name ?? 'this'}'s offer`}
                        accessibilityRole="button"
                        style={styles.socialOfferDeclineButton}
                      >
                        <Text style={styles.declineButtonText}>Decline</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              ))
            )}
            {myParticipant?.status === 'accepted' && !isInitiator && !socialOffers.some((o) => o.offerer_id === myId) && (
              <View style={styles.socialOfferForm}>
                <TextInput
                  style={styles.socialOfferInput}
                  value={socialOfferInput}
                  onChangeText={setSocialOfferInput}
                  placeholder='e.g. "I can drive everyone there"'
                  placeholderTextColor={colors.textTertiary}
                  multiline
                  accessibilityLabel="What can you offer?"
                />
                <TouchableOpacity
                  style={styles.socialOfferSubmitButton}
                  onPress={handleSubmitSocialOffer}
                  disabled={acting}
                  accessibilityLabel="Submit social offer"
                  accessibilityRole="button"
                >
                  {acting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.acceptButtonText}>Offer to Help</Text>}
                </TouchableOpacity>
              </View>
            )}

            {myParticipant?.status === 'accepted' && !isInitiator && (
              <TouchableOpacity onPress={handleLeave} disabled={acting} accessibilityLabel="Leave this group plan" accessibilityRole="button">
                <Text style={styles.declineLink}>Leave Group Plan</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </ScrollView>
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
  excludedTag: { ...typography.caption, color: colors.primary, fontWeight: '700' },
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
