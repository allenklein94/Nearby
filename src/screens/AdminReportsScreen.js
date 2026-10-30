import React, { useEffect, useState } from 'react';
import { presentRecoverableError } from '../utils/recoverableError';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, SafeAreaView, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
import LoadErrorState from '../components/LoadErrorState';
import { PullToRefresh } from '../motion';
import { behaviorEvidenceLines } from '../utils/behaviorCaseEvidence';

// I3 (20270355): reports carry a server copy of the reported content; resolving records an outcome. I1 (20270357): account
// review cases (identical photo + an approved rule; 20270363: behaviour patterns, counts only) are listed above the reports. Both work on a database without those
// migrations: the old columns / direct resolve are used and no cases show.
const REPORT_COLUMNS = 'id, reason, details, created_at, resolved, reporter_id, reported_id, reported:profiles!reports_reported_id_fkey(display_name, suspended_at)';
const CONTENT_COLUMNS = ', content_type, content_excerpt, content_sent_at';
const isMissing = (error) => !!error && ['PGRST202', 'PGRST204', '42703', '42883'].includes(error.code);
const CASE_REASON = {
  many_accounts: 'Same photo on several accounts',
  similar_names: 'Same photo + similar names',
  behavior_pattern: 'Unusual activity pattern',
};

// This screen is reached as a top-level stack push (not a bottom tab),
// headerShown: false in RootNavigator, and previously took no navigation
// prop at all -- the same "reachable, but no visible way back" shape
// found and fixed on FriendDiscoveryScreen.
export default function AdminReportsScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [cases, setCases] = useState([]);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const run = (columns) => supabase
        .from('reports')
        .select(columns)
        .order('resolved', { ascending: true })
        .order('created_at', { ascending: false });
      let { data, error } = await run(REPORT_COLUMNS + CONTENT_COLUMNS);
      if (isMissing(error)) ({ data, error } = await run(REPORT_COLUMNS));
      if (error) throw error;
      setReports(data);
      setLoadError(false);
      const listed = await supabase.rpc('admin_list_account_review_cases');
      setCases(listed.error ? [] : listed.data || []);
    } catch (e) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  // The outcome is recorded with the admin and time (report_actions); before 20270355 the plain resolve is used.
  function markResolved(item) {
    const resolve = async (outcome) => {
      let { error } = await supabase.rpc('admin_resolve_report', { report_id_param: item.id, outcome_param: outcome });
      if (isMissing(error)) ({ error } = await supabase.from('reports').update({ resolved: true }).eq('id', item.id));
      if (error) return presentRecoverableError(Alert, { what: 'complete that', error, onRetry: () => resolve(outcome) });
      load();
    };
    Alert.alert('Resolve this report?', 'Recorded with your account and the time.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'No action needed', onPress: () => resolve('no_action') },
      { text: 'Action taken', onPress: () => resolve('action_taken') },
    ]);
  }

  // A case is a signal for review, never proof: closing it changes nothing about the accounts.
  function closeCase(c) {
    const close = async (outcome) => {
      const { error } = await supabase.rpc('admin_close_account_review_case', { case_id_param: c.id, outcome_param: outcome });
      if (error) return presentRecoverableError(Alert, { what: 'complete that', error, onRetry: () => close(outcome) });
      load();
    };
    Alert.alert('Close this review?', 'Nothing happens to these accounts. Suspend from a report if action is needed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'No action needed', onPress: () => close('no_action') },
      { text: 'Action taken', onPress: () => close('action_taken') },
    ]);
  }

  // Suspension is decided by the server (admin_suspend_user / admin_reinstate_user, 20270351): admin only, recorded with
  // this report, the profile hidden, sessions ended and sign-in refused; every social action refused while suspended.
  // The alert says what the server actually did, never what was intended.
  function suspendReportedUser(item) {
    Alert.alert(
      'Suspend this user?',
      'Hides their profile, signs them out, blocks sign-in and refuses messages, invitations, hosting and every other social action until reinstated. Recorded with this report.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Suspend',
          style: 'destructive',
          onPress: async () => {
            const { data, error } = await supabase.rpc('admin_suspend_user', {
              user_id_param: item.reported_id,
              reason_param: `Report: ${item.reason}`,
              report_id_param: item.id,
            });
            if (error) return presentRecoverableError(Alert, { what: 'complete that', error, onRetry: () => suspendReportedUser(item) });
            Alert.alert(data?.already ? 'Already suspended' : 'Suspended', data?.already ? 'This account was already suspended.' : 'Profile hidden, signed out and blocked from social actions.');
            load();
          },
        },
      ]
    );
  }

  function reinstateReportedUser(item) {
    Alert.alert('Reinstate this user?', 'Restores their profile and sign-in. Recorded in the moderation log.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reinstate',
        onPress: async () => {
          const { data, error } = await supabase.rpc('admin_reinstate_user', {
            user_id_param: item.reported_id,
            reason_param: `Reinstated from report: ${item.reason}`,
          });
          if (error) return presentRecoverableError(Alert, { what: 'complete that', error, onRetry: () => reinstateReportedUser(item) });
          Alert.alert(data?.already ? 'Not suspended' : 'Reinstated', data?.already ? 'This account was not suspended.' : 'Their profile and sign-in are restored.');
          load();
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Reports</Text>
      </View>
      <FlatList
        data={reports}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl }}
        refreshControl={<PullToRefresh refreshing={loading} onRefresh={load} />}
        ListHeaderComponent={cases.length ? (
          <View>
            <Text style={styles.sectionTitle}>Account review</Text>
            {cases.map((c) => (
              <View key={c.id} style={styles.card}>
                <Text style={styles.reason}>{CASE_REASON[c.reason] || c.reason}</Text>
                {behaviorEvidenceLines(c.evidence).map((line) => (
                  <Text key={line} style={styles.meta}>{line}</Text>
                ))}
                {(c.members || []).map((m) => (
                  <Text key={m.user_id} style={styles.meta}>{m.display_name || m.user_id}{m.suspended ? ' · suspended' : ''}</Text>
                ))}
                <Text style={styles.date}>Opened {new Date(c.opened_at).toLocaleString()}</Text>
                <View style={styles.actions}>
                  <TouchableOpacity style={[styles.actionButton, styles.resolveButton]} onPress={() => closeCase(c)} accessibilityRole="button">
                    <Text style={styles.actionText}>Close Review</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
            <Text style={styles.sectionTitle}>Reports</Text>
          </View>
        ) : null}
        ListEmptyComponent={
          loadError ? (
            <LoadErrorState message="Couldn't load reports." onRetry={load} />
          ) : (
            <Text style={styles.empty}>No reports.</Text>
          )
        }
        renderItem={({ item }) => (
          <View style={[styles.card, item.resolved && styles.cardResolved]}>
            <Text style={styles.reason}>{item.reason}</Text>
            <Text style={styles.meta}>Against: {item.reported?.display_name || item.reported_id}</Text>
            {item.reported?.suspended_at ? <Text style={styles.meta}>Suspended {new Date(item.reported.suspended_at).toLocaleString()}</Text> : null}
            {item.details ? <Text style={styles.details}>{item.details}</Text> : null}
            {item.content_excerpt ? (
              <View style={styles.evidence}>
                <Text style={styles.meta}>Reported {item.content_type === 'match_chat' ? 'chat (their last messages)' : 'message'}{item.content_sent_at ? ` · sent ${new Date(item.content_sent_at).toLocaleString()}` : ''}</Text>
                <Text style={styles.details}>{item.content_excerpt}</Text>
              </View>
            ) : null}
            <Text style={styles.date}>{new Date(item.created_at).toLocaleString()}</Text>

            {/* a suspended account can be reinstated from its report even after the report is resolved */}
            {(!item.resolved || item.reported?.suspended_at) && (
              <View style={styles.actions}>
                {item.reported?.suspended_at ? (
                  <TouchableOpacity style={styles.actionButton} onPress={() => reinstateReportedUser(item)} accessibilityRole="button">
                    <Text style={styles.actionText}>Reinstate User</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={styles.actionButton} onPress={() => suspendReportedUser(item)} accessibilityRole="button">
                    <Text style={styles.actionText}>Suspend User</Text>
                  </TouchableOpacity>
                )}
                {!item.resolved && (
                  <TouchableOpacity style={[styles.actionButton, styles.resolveButton]} onPress={() => markResolved(item)}>
                    <Text style={styles.actionText}>Mark Resolved</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.md },
  backButton: { padding: spacing.xs },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  empty: { color: colors.textTertiary, textAlign: 'center', marginTop: spacing.xxl },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardResolved: { opacity: 0.5 },
  sectionTitle: { ...typography.bodyBold, color: colors.textSecondary, marginBottom: spacing.sm, marginTop: spacing.sm },
  evidence: { marginTop: spacing.sm, paddingLeft: spacing.sm, borderLeftWidth: 2, borderLeftColor: colors.border },
  reason: { ...typography.bodyBold, color: colors.textPrimary },
  meta: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  details: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.xs, fontStyle: 'italic' },
  date: { ...typography.small, color: colors.textTertiary, marginTop: spacing.sm },
  actions: { flexDirection: 'row', marginTop: spacing.md, gap: spacing.sm },
  actionButton: { backgroundColor: colors.surfaceElevated, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  resolveButton: { backgroundColor: colors.primary },
  actionText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});