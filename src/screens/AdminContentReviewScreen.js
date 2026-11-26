import React, { useState, useCallback, useEffect } from 'react';
import { presentRecoverableError } from '../utils/recoverableError';
import EmptyCopy from '../components/EmptyCopy';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, SafeAreaView, Alert, Image } from 'react-native';
import { getSignedBusinessOfferMediaUrl } from '../services/businessFulfillment';
import { PullToRefresh } from '../motion';
import FadeInState from '../components/FadeInState';
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
// pre-existing fallback. Exported so BusinessDashboardScreen's own
// persistent "pending review" state (P2 remediation item 11, CLAUDE.md)
// can name the same real target types the same way, matching this file's
// own established BUSINESS_CATEGORIES-from-BusinessPartnerApplyScreen
// reuse precedent rather than a second, drifting copy.
export const TARGET_TYPE_LABELS = {
  business_profile: 'Business profile edit',
  experience: 'Signature Experience',
  offer: 'Standing offer',
  availability: 'Availability posting',
  update: 'Broadcast update',
  offer_response: 'Offer response',
  creative: 'Photo or video (library)',
};

// A held library photo/video: the reviewer sees the image itself (a video through its first sampled frame) before deciding.
function SnapshotMedia({ snapshot, colors }) {
  const path = snapshot.mediaType === 'video' ? (snapshot.posterPath ?? snapshot.framePaths?.[0]) : snapshot.mediaPath;
  const [uri, setUri] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (path) getSignedBusinessOfferMediaUrl(path).then((u) => { if (!cancelled) setUri(u); });
    return () => { cancelled = true; };
  }, [path]);
  if (!uri) return null;
  return (
    <View style={{ marginTop: spacing.sm }}>
      <Image source={{ uri }} style={{ width: '100%', height: 180, borderRadius: radius.md, backgroundColor: colors.surface }} resizeMode="contain" />
      {snapshot.mediaType === 'video' ? <Text style={{ color: colors.textSecondary, marginTop: spacing.xs }}>Video (first frame shown; {snapshot.framePaths?.length ?? 1} frame(s) were checked)</Text> : null}
    </View>
  );
}

// 20270373: held people's content. "Approve" publishes it (an edit is applied, a new item becomes visible, a hidden chat
// message is shown again); "Keep hidden" leaves it unpublished. Never an account action: those stay in Admin review.
const USER_TARGET_LABELS = {
  profiles: 'Profile', gatherings: 'Gathering', communities: 'Community', gathering_questions: 'Gathering Q&A',
  photo_comments: 'Photo comment', community_messages: 'Community chat', gathering_messages: 'Gathering chat',
};
const USER_KIND_LABELS = {
  new_row: 'New, waiting to be shown', edit: 'Edit, waiting to replace the shown text',
  chat_hidden: 'Hidden after sending (high risk)', chat_review: 'Visible, flagged for a look',
};

function heldText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((p) => (p && typeof p === 'object' ? `${p.question ?? ''}: ${p.answer ?? ''}` : String(p))).join('\n');
  if (value && typeof value === 'object') return Object.entries(value).map(([k, v]) => `${k}: ${v}`).join('\n');
  return String(value ?? '');
}

function HeldUserItem({ item, styles, busy, onDecide }) {
  const chatVisible = item.kind === 'chat_review';
  return (
    <View style={styles.card}>
      <Text style={styles.partnerName}>{item.author_name || 'Someone'}</Text>
      <Text style={styles.targetType}>{USER_TARGET_LABELS[item.target_table] ?? item.target_table} · {item.field} · {USER_KIND_LABELS[item.kind] ?? item.kind}</Text>
      <Text style={styles.snapshotBody}>{heldText(item.held_value)}</Text>
      {item.reason ? <Text style={styles.reasoning}>{item.reason}</Text> : null}
      <Text style={styles.timestamp}>{item.created_at ? new Date(item.created_at).toLocaleString() : ''}</Text>
      <View style={styles.actionsRow}>
        <TouchableOpacity style={styles.approveButton} disabled={busy} onPress={() => onDecide(item, true)}
          accessibilityRole="button" accessibilityLabel={chatVisible ? 'No issue, keep it visible' : 'Approve and show it'}>
          <Text style={styles.approveButtonText}>{chatVisible ? 'No Issue' : 'Approve & Show'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.denyButton} disabled={busy} onPress={() => onDecide(item, false)}
          accessibilityRole="button" accessibilityLabel={chatVisible ? 'Hide this message' : 'Keep it hidden'}>
          <Text style={styles.denyButtonText}>{chatVisible ? 'Hide' : 'Keep Hidden'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

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
    const [{ data, error }, people] = await Promise.all([
      supabase.rpc('admin_get_pending_content_screenings'),
      // 20270373: people's held text (profile, gathering, community, Q&A, comment) and flagged group-chat messages. Before
      // the migration is live the function doesn't exist: nothing extra.
      supabase.rpc('admin_list_held_user_content'),
    ]);
    if (error) console.error('AdminContentReviewScreen load error', error);
    const userItems = (people?.error ? [] : people?.data ?? []).map((u) => ({ ...u, id: `u:${u.item_id}`, userItem: true }));
    setItems([...(error ? [] : data ?? []), ...userItems]);
  }, []);

  async function handleUserDecision(item, approve) {
    setProcessingIds((prev) => ({ ...prev, [item.id]: true }));
    const { error } = await supabase.rpc('admin_decide_held_user_content', { p_item_id: item.item_id, p_approve: approve, p_note: null });
    if (error) presentRecoverableError(Alert, { what: 'complete that', error, onRetry: () => handleUserDecision(item, approve) });
    else setItems((prev) => prev.filter((i) => i.id !== item.id));
    setProcessingIds((prev) => ({ ...prev, [item.id]: false }));
  }

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
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleReview(item, approve) });
    }
    setProcessingIds((prev) => ({ ...prev, [item.id]: false }));
  }

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: spacing.lg }}
        refreshControl={<PullToRefresh refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <FadeInState style={styles.emptyState}>
            <EmptyCopy id="admin_content_review" />
          </FadeInState>
        }
        renderItem={({ item }) => {
          if (item.userItem) return <HeldUserItem item={item} styles={styles} busy={!!processingIds[item.id]} onDecide={handleUserDecision} />;
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
              {item.target_type === 'creative' ? <SnapshotMedia snapshot={snapshot} colors={colors} /> : null}

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
