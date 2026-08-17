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
} from '../services/dateProposals';
import LoadErrorState from '../components/LoadErrorState';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

const TERMINAL_STATUS_COPY = {
  declined: "Didn't work out that time",
  withdrawn: 'Withdrawn',
};

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
  const [proposal, setProposal] = useState(null);
  const [businessRequest, setBusinessRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [planText, setPlanText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoadError(false);
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData?.session?.user?.id;
      setMyId(uid ?? null);

      const latest = await getLatestDateProposal(matchId);
      setProposal(latest);

      if (latest?.status === 'accepted') {
        const request = await getMatchBusinessRequest(matchId);
        setBusinessRequest(request);
      } else {
        setBusinessRequest(null);
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
      await proposeDate(matchId, planText.trim());
      setPlanText('');
      await load();
    } catch (e) {
      Alert.alert('Something went wrong', e.message);
    }
    setSubmitting(false);
  }

  async function handleRespond(accept) {
    setSubmitting(true);
    try {
      await respondToDateProposal(proposal.id, accept);
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

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <Text style={styles.heading}>Plan Something Together</Text>
          <Text style={styles.subtitle}>
            Propose a plan with {matchName} -- once they say yes, Nearby can ask real nearby businesses to help make it happen.
          </Text>

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
              {businessRequest ? (
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
                  onPress={() => navigation.navigate('AskBusiness', { matchId, matchName })}
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
              <Text style={styles.label}>What do you have in mind?</Text>
              <TextInput
                style={styles.textArea}
                placeholder="Dinner Friday around 7?"
                placeholderTextColor={colors.textTertiary}
                value={planText}
                onChangeText={setPlanText}
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
  textArea: {
    ...typography.body, color: colors.textPrimary, backgroundColor: colors.surface,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, minHeight: 90, textAlignVertical: 'top',
  },
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
