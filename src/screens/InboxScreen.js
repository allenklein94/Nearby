import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import MatchesScreen from './MatchesScreen';
import ActivityScreen from './ActivityScreen';
import { getMyGatheringChats } from '../services/gatherings';
import { getMyCommunities } from '../services/communities';
import { getPendingInvitesCount } from '../services/homeDashboard';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

// Connection requests, invitations, and reminders used to be three
// separate top-level tabs here — collapsed into real named sections
// inside ActivityScreen itself (see that file's "Connection
// Requests"/"Invitations"/"Upcoming" groups), matching a clean
// Messages/Activity split. `initialSection` deep-links (e.g. Home's
// pending-invites banner) still work — a value other than 'messages'
// still lands on Activity, and a recognized sub-value additionally
// brings that group to the front there instead of hiding the rest.
const SUBSECTION_VALUES = ['requests', 'invitations', 'reminders'];

// A thin wrapper, not a merge — Messages and Activity stay
// completely separate, already-working screens underneath. This
// just toggles which one renders, avoiding any risk to either
// screen's real, complex internal logic (celebration modal, premium
// gating, compatibility scoring, etc).
export default function InboxScreen(props) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const initialParam = props.route?.params?.initialSection;
  const [section, setSection] = useState(initialParam && initialParam !== 'messages' ? 'activity' : 'messages');
  const [activitySubSection, setActivitySubSection] = useState(SUBSECTION_VALUES.includes(initialParam) ? initialParam : undefined);
  const [groupChats, setGroupChats] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);

  // The tab navigator keeps InboxScreen mounted, so a fresh navigation into
  // it (e.g. from Home's pending-invites banner) with a new initialSection
  // param wouldn't otherwise be seen — useState's initial value only
  // applies on first mount. Re-applies only when the param itself changes,
  // so a manual tab switch afterward isn't overridden by a stale re-focus.
  useEffect(() => {
    const param = props.route?.params?.initialSection;
    if (param) {
      setSection(param !== 'messages' ? 'activity' : 'messages');
      setActivitySubSection(SUBSECTION_VALUES.includes(param) ? param : undefined);
    }
  }, [props.route?.params?.initialSection]);

  const loadGroupChats = useCallback(async () => {
    try {
      const [gatheringChats, communities] = await Promise.all([getMyGatheringChats(), getMyCommunities()]);
      setGroupChats([
        ...gatheringChats.map((g) => ({ kind: 'gathering', id: g.id, title: g.title })),
        ...communities.map((c) => ({ kind: 'community', id: c.id, title: c.name })),
      ]);
    } catch (e) {
      console.error('loadGroupChats failed', e);
    }
  }, []);

  // The same real aggregate Home's own pending-invites banner uses —
  // pending join requests + pending friend requests + pending social
  // invites — reused here for the Activity tab's badge rather than
  // inventing a second count.
  const loadPendingCount = useCallback(async () => {
    try {
      const count = await getPendingInvitesCount();
      setPendingCount(count);
    } catch (e) {
      console.error('loadPendingCount failed', e);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadGroupChats();
      loadPendingCount();
    }, [loadGroupChats, loadPendingCount])
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle} accessibilityRole="header">Inbox</Text>
            <Text style={styles.subtitle}>Messages, requests, and everything else waiting for you.</Text>
          </View>
          <TouchableOpacity
            style={styles.friendsLink}
            onPress={() => props.navigation.navigate('Friends')}
            accessibilityLabel="Friends"
            accessibilityRole="button"
          >
            <Text style={styles.friendsLinkText}>🤝 Friends</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.toggleRow}>
        <TouchableOpacity
          style={[styles.toggleButton, section === 'messages' && styles.toggleButtonActive]}
          onPress={() => setSection('messages')}
          accessibilityLabel="Messages"
          accessibilityRole="button"
          accessibilityState={{ selected: section === 'messages' }}
        >
          <Text style={[styles.toggleText, section === 'messages' && styles.toggleTextActive]}>💬 Messages</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleButton, section === 'activity' && styles.toggleButtonActive]}
          onPress={() => setSection('activity')}
          accessibilityLabel={`Activity${pendingCount > 0 ? `, ${pendingCount} pending` : ''}`}
          accessibilityRole="button"
          accessibilityState={{ selected: section === 'activity' }}
        >
          <Text style={[styles.toggleText, section === 'activity' && styles.toggleTextActive]}>
            🔔 Activity{pendingCount > 0 ? ` (${pendingCount})` : ''}
          </Text>
        </TouchableOpacity>
      </View>
      <View style={{ flex: 1 }}>
        {section === 'messages' && (
          <>
            {groupChats.length > 0 && (
              <View style={styles.groupChatsRow}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
                  {groupChats.map((chat) => (
                    <TouchableOpacity
                      key={`${chat.kind}-${chat.id}`}
                      style={styles.groupChatChip}
                      onPress={() => props.navigation?.navigate(
                        chat.kind === 'gathering' ? 'GatheringChat' : 'CommunityChat',
                        chat.kind === 'gathering'
                          ? { gatheringId: chat.id, gatheringTitle: chat.title }
                          : { communityId: chat.id, communityName: chat.title }
                      )}
                      activeOpacity={0.85}
                      accessibilityLabel={`Open ${chat.title} group chat`}
                      accessibilityRole="button"
                    >
                      <Text style={styles.groupChatChipIcon}>{chat.kind === 'gathering' ? '🎉' : '🏘️'}</Text>
                      <Text style={styles.groupChatChipText} numberOfLines={1}>{chat.title} Chat</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
            <MatchesScreen {...props} />
          </>
        )}
        {section === 'activity' && <ActivityScreen {...props} initialSubSection={activitySubSection} />}
      </View>
    </SafeAreaView>
  );
}
const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  subtitle: { ...typography.body, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.sm },
  friendsLink: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, marginTop: 2,
  },
  friendsLinkText: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
  toggleRow: { flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  toggleButton: {
    flex: 1, paddingVertical: spacing.sm, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center',
  },
  toggleButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  toggleText: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },
  toggleTextActive: { color: '#fff' },
  groupChatsRow: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  groupChatChip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, maxWidth: 160,
  },
  groupChatChipIcon: { fontSize: 14, marginRight: 4 },
  groupChatChipText: { color: colors.textPrimary, fontWeight: '600', fontSize: 13 },
});
