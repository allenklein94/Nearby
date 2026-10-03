import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { presentRecoverableError } from '../utils/recoverableError';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { getGatheringRequestsForHost, approveInterest, hostRemoveAttendee } from '../services/gatherings';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { pendingReview, applyDecision, moderationActions } from '../utils/hostCommandCenter';
import { blockAndUnmatch } from '../services/blockedUsers';
import ReportBlockModal from './ReportBlockModal';

// Host-only: approve/decline join requests and remove attendees, inline on
// GatheringDetail (the one place everything about a gathering is managed).
// Same RPCs and copy the Gatherings hosting list uses.
// expanded=false (the host command center's default): pending requests sit behind one "N requests to join · Review" row
// (owner item 144); Review opens them in place, each "Name / Requested to join" with Approve | Decline. Going and
// waitlisted people appear when the host taps "Manage attendees". refreshKey reloads the list when the parent reloads.
export default function HostAttendeeManager({ gatheringId, onChanged, expanded = true, refreshKey }) {
  const { t } = useLanguage();
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [rows, setRows] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  // Moderation (item 146): which person's More menu is open, and who is being reported. Only inside Manage attendees.
  const [menuFor, setMenuFor] = useState(null);
  const [reporting, setReporting] = useState(null);

  // Only the newest load may write the list: a focus reload and a post-decision reload can overlap, and an older answer
  // landing last would bring back a request already decided (count and list come from this one array, item 144).
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    const next = await getGatheringRequestsForHost(gatheringId);
    if (seq === loadSeq.current) setRows(next);
  }, [gatheringId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function refresh() {
    await load();
    onChanged?.();
  }

  async function handleApprove(row) {
    try {
      const result = await approveInterest(row.id);
      // The decided request leaves the pending set at once (the Review row and its count follow), then the server reload
      // confirms it.
      setRows((prev) => applyDecision(prev, row.id, result?.status === 'waitlisted' ? 'waitlisted' : 'approved'));
      if (result?.status === 'waitlisted') {
        Alert.alert(t('ui.gatheringParts.gatheringFull'), t('ui.gatheringParts.thisGatheringIsAlreadyAt'));
      } else {
        Alert.alert(t('ui.gatheringParts.approved'), t('ui.gatheringParts.aMatchWasCreatedYou'));
      }
      refresh();
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleApprove(row) });
    }
  }

  function confirmRemove(row, isRequest) {
    const name = row.profiles?.display_name ?? 'this person';
    Alert.alert(
      isRequest ? t('ui.gatheringParts.decline', { name: name }) : t('ui.gatheringParts.remove', { name: name }),
      isRequest ? t('ui.gatheringParts.theyllBeToldYouCouldnt') : t('ui.gatheringParts.theyllBeTakenOffThe'),
      [
        { text: t('ui.gatheringParts.cancel'), style: 'cancel' },
        {
          text: isRequest ? t('ui.gatheringParts.decline2') : t('ui.gatheringParts.remove2'),
          style: 'destructive',
          onPress: async () => {
            try {
              await hostRemoveAttendee(row.id);
              setRows((prev) => applyDecision(prev, row.id, null));
              refresh();
            } catch (e) {
              presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => confirmRemove(row, isRequest) });
            }
          },
        },
      ]
    );
  }

  // Block from Manage attendees: take them off this gathering first (decline or remove, same server action as Remove),
  // then block. One confirmation says both.
  function confirmBlock(row) {
    const name = row.profiles?.display_name ?? t('ui.gatheringParts.someone');
    Alert.alert(
      t('ui.hostCenter.moderate.blockTitle', { name }),
      t('ui.hostCenter.moderate.blockBody'),
      [
        { text: t('ui.gatheringParts.cancel'), style: 'cancel' },
        {
          text: t('ui.hostCenter.moderate.block'),
          style: 'destructive',
          onPress: async () => {
            try {
              await hostRemoveAttendee(row.id);
              setRows((prev) => applyDecision(prev, row.id, null));
              await blockAndUnmatch(row.user_id);
              setMenuFor(null);
              refresh();
            } catch (e) {
              presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => confirmBlock(row) });
            }
          },
        },
      ]
    );
  }

  function runModeration(row, action) {
    setMenuFor(null);
    if (action === 'remove') confirmRemove(row, false);
    else if (action === 'block') confirmBlock(row);
    else if (action === 'report') setReporting({ id: row.user_id, name: row.profiles?.display_name });
  }

  const review = pendingReview(rows);
  // Once the last request is decided the row disappears, and the next request starts collapsed again.
  useEffect(() => {
    if (!review.show && reviewOpen) setReviewOpen(false);
  }, [review.show, reviewOpen]);

  const renderRow = (row, manage = false) => {
    const name = row.profiles?.display_name ?? t('ui.gatheringParts.someone');
    const actions = manage ? moderationActions(row) : [];
    const more = actions.length > 0 && (
      <TouchableOpacity
        onPress={() => setMenuFor((id) => (id === row.id ? null : row.id))}
        accessibilityRole="button"
        accessibilityLabel={t('ui.hostCenter.moderate.moreA11y', { name })}
        accessibilityState={{ expanded: menuFor === row.id }}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.more}>{t('ui.hostCenter.moderate.more')}</Text>
      </TouchableOpacity>
    );
    return (
      <View key={row.id}>
      <View style={styles.row}>
        {row.status === 'pending' ? (
          <View style={styles.who}>
            <Text style={styles.name}>{name}</Text>
            <Text style={styles.sub}>{t('ui.hostCenter.review.requested')}</Text>
          </View>
        ) : (
          <Text style={styles.name}>{name}</Text>
        )}
        {row.status === 'pending' ? (
          <View style={styles.actions}>
            <TouchableOpacity style={styles.approve} onPress={() => handleApprove(row)} accessibilityLabel={t('ui.gatheringParts.approveSRequestA11y', { name: name })} accessibilityRole="button">
              <Text style={styles.approveText}>{t('ui.gatheringParts.approve')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => confirmRemove(row, true)} accessibilityLabel={t('ui.gatheringParts.declineSRequestA11y', { name: name })} accessibilityRole="button">
              <Text style={styles.decline}>{t('ui.gatheringParts.decline2')}</Text>
            </TouchableOpacity>
            {more}
          </View>
        ) : (
          <View style={styles.actions}>
            <Text style={styles.status}>{row.status === 'waitlisted' ? t('ui.gatheringParts.waitlisted') : t('ui.gatheringParts.approved2')}</Text>
            {more}
          </View>
        )}
      </View>
      {menuFor === row.id && actions.length > 0 && (
        <View style={styles.menu}>
          {actions.map((a) => (
            <TouchableOpacity key={a} onPress={() => runModeration(row, a)} accessibilityRole="button" style={styles.menuItem}>
              <Text style={a === 'report' ? styles.menuText : styles.decline}>{t(`ui.hostCenter.moderate.${a}`)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      </View>
    );
  };

  const reportModal = (
    <ReportBlockModal
      visible={!!reporting}
      reportOnly
      onClose={() => setReporting(null)}
      reportedUserId={reporting?.id}
      reportedUserName={reporting?.name}
    />
  );

  // Collapsed (default): the one Review row; tapping it opens the requests in place. No pending request = nothing.
  if (!expanded) {
    if (!review.show) return null;
    return (
      <View style={styles.wrap}>
        <TouchableOpacity
          style={styles.reviewRow}
          onPress={() => setReviewOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={t('ui.hostCenter.review.a11y')}
          accessibilityState={{ expanded: reviewOpen }}
        >
          <Text style={styles.reviewCount}>{t('ui.hostCenter.stat.requests', { count: review.count })}</Text>
          <Text style={styles.reviewLink}>{reviewOpen ? t('ui.hostCenter.review.hide') : t('ui.hostCenter.review.open')}</Text>
        </TouchableOpacity>
        {reviewOpen && review.rows.map((row) => renderRow(row))}
      </View>
    );
  }

  if (rows == null || rows.length === 0) return null;
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{t('ui.gatheringParts.requestsAttendees')}</Text>
      {rows.map((row) => renderRow(row, true))}
      {reportModal}
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  wrap: { marginTop: spacing.sm },
  label: { color: colors.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: spacing.xs },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.xs },
  name: { color: colors.textPrimary, fontSize: 14, flexShrink: 1 },
  who: { flexShrink: 1 },
  sub: { color: colors.textSecondary, fontSize: 12, marginTop: 1 },
  reviewRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  reviewCount: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  reviewLink: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  approve: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 6 },
  approveText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  decline: { color: colors.danger, fontSize: 12, fontWeight: '600' },
  status: { color: colors.success, fontSize: 12, fontWeight: '700' },
  more: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  menu: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md, paddingBottom: spacing.xs },
  menuItem: { paddingVertical: 2 },
  menuText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
});
