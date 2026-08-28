import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, SafeAreaView, Alert, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

// Decision 6, Phase 1 (CLAUDE.md's Aug 27 2026 plan) -- the real Content
// Review Queue the locked design calls for: every business_profile
// submission still genuinely awaiting a human decision (medium/uncertain
// risk tier), approve/deny mediated entirely through
// admin_review_business_content_screening() -- never a direct client
// write. A HIGH result never appears here at all (auto_blocked at write
// time, no human decision needed); a LOW result never appears here either
// (published immediately, review_outcome stays null but risk_tier isn't
// medium/uncertain).
//
// Decision 6, Phase 5 -- a `source: 'resweep'` row (an already-live
// listing periodic re-checking flagged, as opposed to a brand-new
// submission awaiting first publish) also shows up here now, including a
// HIGH-tier one (never auto-blocked for a re-sweep, per the locked
// design's own safety-motivated departure). Same underlying RPC call
// either way -- only the badge and the two action buttons' displayed
// copy differ, since a re-sweep row's approve/deny means something
// genuinely different: "false alarm, dismiss" / "confirmed problem,
// needs manual follow-up" rather than "publish this" / "reject this."

const RISK_LABELS = {
  medium: 'Medium risk',
  uncertain: 'Uncertain',
  // Only ever reaches this queue for a resweep-source row -- a
  // submission-source HIGH is auto_blocked at write time and never gets
  // here.
  high: 'High risk',
};

// Decision 6, Phases 1-3 -- every real value in the schema's own CHECK
// constraint is now a live, screened target_type. Falls back to the raw
// value for anything unrecognized, matching this screen's own
// pre-existing fallback.
const TARGET_TYPE_LABELS = {
  business_profile: 'Business profile edit',
  experience: 'Signature Experience',
  offer: 'Standing offer',
  availability: 'Availability posting',
  update: 'Broadcast update',
  offer_response: 'Offer response',
};

const CATEGORY_LABELS = {
  illegal_drugs: 'Illegal drugs',
  weapons: 'Weapons',
  explosives: 'Explosives',
  fraud_scams: 'Fraud / scams',
  counterfeit_goods: 'Counterfeit goods',
  sexual_exploitation: 'Sexual exploitation',
  illegal_gambling: 'Illegal gambling',
  dangerous_services: 'Dangerous services',
  hate_extremist: 'Hate / extremist activity',
  human_trafficking: 'Human trafficking',
  unregulated_medical_claims: 'Unregulated medical claims',
  financial_scams: 'Financial scams',
  business_impersonation: 'Business impersonation',
};

export default function AdminContentReviewScreen() {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [items, setItems] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [processingIds, setProcessingIds] = useState({});

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_get_pending_content_screenings');
    if (error) {
      console.error('AdminContentReviewScreen load error', error);
      setItems([]);
      return;
    }
    setItems(data ?? []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function handleReview(item, approve) {
    setProcessingIds((prev) => ({ ...prev, [item.id]: true }));
    try {
      await supabase.rpc('admin_review_business_content_screening', {
        screening_id_param: item.id,
        approve_param: approve,
      });
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setProcessingIds((prev) => ({ ...prev, [item.id]: false }));
  }

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: spacing.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>Nothing awaiting review — every recent submission was either published automatically or blocked outright.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const snapshot = item.content_snapshot ?? {};
          const isResweep = item.source === 'resweep';
          return (
            <View style={styles.card}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.partnerName}>{item.partner_name}</Text>
                <Text
                  style={[
                    styles.tierBadge,
                    item.risk_tier === 'medium' ? styles.tierMedium
                      : item.risk_tier === 'high' ? styles.tierHigh
                      : styles.tierUncertain,
                  ]}
                >
                  {RISK_LABELS[item.risk_tier] ?? item.risk_tier}
                </Text>
              </View>
              {isResweep && (
                <View style={styles.resweepBadge}>
                  <Text style={styles.resweepBadgeText}>🔍 Routine re-check</Text>
                </View>
              )}
              <Text style={styles.targetType}>
                {TARGET_TYPE_LABELS[item.target_type] ?? item.target_type}
                {item.target_type === 'experience' ? (snapshot.experienceId ? ' (edit)' : ' (new)') : ''}
              </Text>

              {(snapshot.name || snapshot.title) ? <Text style={styles.snapshotName}>{snapshot.name ?? snapshot.title}</Text> : null}
              {/* offer/availability both carry title+description, already
                  covered by the fallback above -- update carries body
                  instead of description, offer_response has no title at
                  all and carries its free text as offerDescription. */}
              {snapshot.description ? <Text style={styles.snapshotBody}>{snapshot.description}</Text> : null}
              {snapshot.body ? <Text style={styles.snapshotBody}>{snapshot.body}</Text> : null}
              {snapshot.offerDescription ? <Text style={styles.snapshotBody}>{snapshot.offerDescription}</Text> : null}
              {snapshot.differentiator ? <Text style={styles.snapshotBody}>"{snapshot.differentiator}"</Text> : null}

              {item.matched_categories?.length > 0 && (
                <View style={styles.categoryRow}>
                  {item.matched_categories.map((c) => (
                    <View key={c} style={styles.categoryChip}>
                      <Text style={styles.categoryChipText}>{CATEGORY_LABELS[c] ?? c}</Text>
                    </View>
                  ))}
                </View>
              )}

              {item.model_reasoning ? <Text style={styles.reasoning}>"{item.model_reasoning}"</Text> : null}
              <Text style={styles.timestamp}>{item.created_at ? new Date(item.created_at).toLocaleString() : ''}</Text>

              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={styles.approveButton}
                  onPress={() => handleReview(item, true)}
                  disabled={processingIds[item.id]}
                  accessibilityLabel={
                    isResweep
                      ? `No issue with ${item.partner_name}'s already-live content`
                      : `Approve and publish ${item.partner_name}'s content`
                  }
                  accessibilityRole="button"
                >
                  <Text style={styles.approveButtonText}>{isResweep ? 'No Issue' : 'Approve & Publish'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.denyButton}
                  onPress={() => handleReview(item, false)}
                  disabled={processingIds[item.id]}
                  accessibilityLabel={
                    isResweep
                      ? `Flag ${item.partner_name}'s already-live content for follow-up`
                      : `Deny ${item.partner_name}'s content`
                  }
                  accessibilityRole="button"
                >
                  <Text style={styles.denyButtonText}>{isResweep ? 'Flag for Follow-Up' : 'Deny'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl },
  emptyText: { color: colors.textTertiary, textAlign: 'center', lineHeight: 20 },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.md, ...shadow.card,
  },
  partnerName: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 16 },
  tierBadge: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  tierMedium: { color: colors.primary },
  tierUncertain: { color: colors.textSecondary },
  tierHigh: { color: colors.danger },
  resweepBadge: {
    alignSelf: 'flex-start', backgroundColor: colors.surfaceElevated, borderRadius: radius.full,
    paddingHorizontal: spacing.sm, paddingVertical: 2, marginTop: spacing.xs,
  },
  resweepBadgeText: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
  targetType: { color: colors.textTertiary, fontSize: 12, marginTop: 2, marginBottom: spacing.sm },
  snapshotName: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 14, marginBottom: 2 },
  snapshotBody: { color: colors.textSecondary, fontSize: 13, marginBottom: spacing.xs, lineHeight: 18 },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs, marginBottom: spacing.xs },
  categoryChip: { backgroundColor: colors.danger + '22', borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  categoryChipText: { color: colors.danger, fontSize: 11, fontWeight: '600' },
  reasoning: { color: colors.textTertiary, fontSize: 12, fontStyle: 'italic', marginTop: spacing.xs, lineHeight: 17 },
  timestamp: { color: colors.textTertiary, fontSize: 11, marginTop: spacing.xs, marginBottom: spacing.sm },
  actionsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  approveButton: { flex: 1, backgroundColor: colors.success, borderRadius: radius.full, paddingVertical: 10, alignItems: 'center' },
  approveButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  denyButton: { flex: 1, backgroundColor: colors.surfaceElevated, borderRadius: radius.full, paddingVertical: 10, alignItems: 'center' },
  denyButtonText: { color: colors.textSecondary, fontWeight: '700', fontSize: 13 },
});
