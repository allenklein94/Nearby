import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { hostSummaryStats, hostActions, messageBadge } from '../utils/hostCommandCenter';

const INVITE_PREVIEW = 5;

// The host's command center on GatheringDetail (owner item 143). Presentation only: every figure and row comes from
// utils/hostCommandCenter.js over data the host may already read, and every action calls a handler the screen already
// had (invite modal, EditGathering, group chat, HostAttendeeManager, the cancel confirmation). The business section is
// passed in as children because its flows (ask now, choose a business, the booked card) stay where they were built.
export default function HostCommandCenter({
  stats,
  invitations,
  canEdit,
  canInvite,
  attendeesExpanded,
  messageCount,
  onInvite,
  onEdit,
  onMessage,
  onToggleAttendees,
  onCancel,
  attendeeManager,
  businessSection,
}) {
  const { t } = useLanguage();
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [showAllInvites, setShowAllInvites] = useState(false);

  const statRows = hostSummaryStats(stats);
  const invites = invitations ?? [];
  const visibleInvites = showAllInvites ? invites : invites.slice(0, INVITE_PREVIEW);
  const actions = hostActions({ canEdit, canInvite });
  // The Message chip keeps its label; the count is a small neutral pill beside it (a total, not an unread alert, so
  // never the red unread badge). 0 or unknown = no pill.
  const msgBadge = messageBadge(messageCount);

  const actionLabel = (a) => {
    if (a === 'manage') return t(attendeesExpanded ? 'ui.hostCenter.action.hideAttendees' : 'ui.hostCenter.action.manage');
    return t(`ui.hostCenter.action.${a}`);
  };
  const onAction = { invite: onInvite, edit: onEdit, message: onMessage, manage: onToggleAttendees, cancel: onCancel };

  return (
    <View>
      {statRows.length > 0 && (
        <View style={styles.statsRow}>
          {statRows.map((s) => (
            <Text key={s.key} style={[styles.stat, s.key === 'going' && styles.statLead]}>
              {t(`ui.hostCenter.stat.${s.key}`, { count: s.value })}
            </Text>
          ))}
        </View>
      )}
      {statRows.some((s) => s.key === 'interested') && (
        <Text style={styles.note}>{t('ui.hostCenter.interestedNote')}</Text>
      )}

      {attendeeManager}

      {invites.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t('ui.hostCenter.section.invitations')}</Text>
          {visibleInvites.map((row) => (
            <View key={row.userId} style={styles.inviteRow}>
              <Text style={styles.inviteName} numberOfLines={1}>{row.name ?? t('ui.hostCenter.aFriend')}</Text>
              <Text style={[styles.inviteStatus, row.status === 'going' && { color: colors.success }]}>
                {t(`ui.hostCenter.invite.${row.status}`)}
              </Text>
            </View>
          ))}
          {invites.length > INVITE_PREVIEW && (
            <TouchableOpacity onPress={() => setShowAllInvites((v) => !v)} accessibilityRole="button">
              <Text style={styles.link}>
                {showAllInvites ? t('ui.hostCenter.showLess') : t('ui.hostCenter.showAll', { count: invites.length })}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {businessSection ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t('ui.hostCenter.section.business')}</Text>
          {businessSection}
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t('ui.hostCenter.section.actions')}</Text>
        <View style={styles.actionsRow}>
          {actions.map((a) => (
            <TouchableOpacity
              key={a}
              onPress={onAction[a]}
              style={[styles.actionChip, a === 'cancel' && styles.actionChipDanger]}
              accessibilityRole="button"
              accessibilityLabel={a === 'message' && msgBadge ? t('ui.hostCenter.messageCountA11y', { count: messageCount }) : actionLabel(a)}
              accessibilityState={a === 'manage' ? { expanded: !!attendeesExpanded } : undefined}
            >
              <View style={styles.actionInner}>
                <Text style={[styles.actionText, a === 'cancel' && { color: colors.danger }]}>{actionLabel(a)}</Text>
                {a === 'message' && msgBadge ? (
                  <View style={styles.countPill} testID="host-message-count">
                    <Text style={styles.countPillText}>{msgBadge}</Text>
                  </View>
                ) : null}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md, rowGap: 2, marginTop: spacing.xs },
  stat: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  statLead: { color: colors.textPrimary, fontWeight: '800' },
  note: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  section: { marginTop: spacing.md },
  sectionLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: spacing.xs, textTransform: 'uppercase' },
  inviteRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3, gap: spacing.sm },
  inviteName: { color: colors.textPrimary, fontSize: 14, flexShrink: 1 },
  inviteStatus: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  link: { color: colors.primary, fontSize: 13, fontWeight: '600', marginTop: spacing.xs },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  actionChip: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.full,
    paddingHorizontal: spacing.md, paddingVertical: 6, backgroundColor: colors.surface,
  },
  actionChipDanger: { borderColor: colors.danger },
  actionInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionText: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
  countPill: {
    minWidth: 18, height: 18, borderRadius: radius.full, paddingHorizontal: 5,
    backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  countPillText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
});
