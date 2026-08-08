import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, FlatList, ScrollView, Image, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import MatchesScreen from './MatchesScreen';
import ActivityScreen from './ActivityScreen';
import { getAllPendingRequests, approveInterest, getUpcomingReminders, getMyGatheringChats } from '../services/gatherings';
import { getPendingFriendRequests, respondToFriendRequest } from '../services/friends';
import { getMyReceivedInvites, respondToInvite } from '../services/invites';
import { getMyCommunities } from '../services/communities';
import { getSignedPhotoUrl } from '../services/photos';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius } from '../theme';

// A thin wrapper, not a merge — Messages and Activity stay
// completely separate, already-working screens underneath. This
// just toggles which one renders, avoiding any risk to either
// screen's real, complex internal logic (celebration modal,
// premium gating, compatibility scoring, etc). Requests is new,
// genuinely built from real pending gathering_interest rows across
// every gathering you host, not a re-labeled version of something
// else.
export default function InboxScreen(props) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [section, setSection] = useState('messages');
  const [requests, setRequests] = useState([]);
  const [photoUrls, setPhotoUrls] = useState({});
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [invitations, setInvitations] = useState([]);
  const [loadingInvitations, setLoadingInvitations] = useState(true);
  const [socialInvites, setSocialInvites] = useState([]);
  const [loadingSocialInvites, setLoadingSocialInvites] = useState(true);
  const [reminders, setReminders] = useState([]);
  const [loadingReminders, setLoadingReminders] = useState(true);
  const [groupChats, setGroupChats] = useState([]);

  const loadRequests = useCallback(async () => {
    try {
      const results = await getAllPendingRequests();
      setRequests(results);
      const urlEntries = await Promise.all(
        results.map(async (r) => {
          const path = r.profiles?.photo_url;
          if (!path) return [r.id, null];
          const url = await getSignedPhotoUrl(path);
          return [r.id, url];
        })
      );
      setPhotoUrls(Object.fromEntries(urlEntries));
    } catch (e) {
      // Without this, a failure here left the Requests section
      // spinning forever, since setLoadingRequests(false) would
      // never be reached.
      console.error('loadRequests failed', e);
    } finally {
      setLoadingRequests(false);
    }
  }, []);
  const loadInvitations = useCallback(async () => {
    try {
      const results = await getPendingFriendRequests();
      setInvitations(results);
    } catch (e) {
      console.error('loadInvitations failed', e);
    } finally {
      setLoadingInvitations(false);
    }
  }, []);
  const loadSocialInvites = useCallback(async () => {
    try {
      const results = await getMyReceivedInvites();
      setSocialInvites(results);
    } catch (e) {
      console.error('loadSocialInvites failed', e);
    } finally {
      setLoadingSocialInvites(false);
    }
  }, []);
  const loadReminders = useCallback(async () => {
    try {
      const results = await getUpcomingReminders();
      setReminders(results);
    } catch (e) {
      console.error('loadReminders failed', e);
    } finally {
      setLoadingReminders(false);
    }
  }, []);

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

  useFocusEffect(
    useCallback(() => {
      loadRequests();
      loadInvitations();
      loadSocialInvites();
      loadReminders();
      loadGroupChats();
    }, [loadRequests, loadInvitations, loadSocialInvites, loadReminders, loadGroupChats])
  );

  function formatTimeUntil(iso) {
    const diffMs = new Date(iso).getTime() - Date.now();
    const diffHours = Math.round(diffMs / (60 * 60 * 1000));
    if (diffHours < 1) return 'starting soon';
    if (diffHours === 1) return 'in 1 hour';
    return `in ${diffHours} hours`;
  }

  async function handleApprove(request) {
    try {
      await approveInterest(request.id);
      loadRequests();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  async function handleRespondInvitation(invitation, accept) {
    try {
      await respondToFriendRequest(invitation.friendshipId, accept);
      loadInvitations();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  async function handleRespondSocialInvite(invite, accept) {
    try {
      await respondToInvite(invite.id, accept);
      loadSocialInvites();
      if (accept) {
        const screen = invite.inviteType === 'gathering' ? 'GatheringDetail' : 'CommunityDetail';
        const params = invite.inviteType === 'gathering'
          ? { gatheringId: invite.targetId }
          : { communityId: invite.targetId, communityName: invite.targetTitle };
        props.navigation?.navigate(screen, params);
      }
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  // Combined so the "Invites" tab reflects real invites of every kind
  // this app actually has (friend requests + gathering/community
  // invites), not just friend requests as before.
  const combinedInvites = [
    ...invitations.map((i) => ({ kind: 'friend', ...i })),
    ...socialInvites.map((i) => ({ kind: 'social', ...i })),
  ];

  return (
    <SafeAreaView style={styles.container}>
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
          style={[styles.toggleButton, section === 'requests' && styles.toggleButtonActive]}
          onPress={() => setSection('requests')}
          accessibilityLabel={`Requests${requests.length > 0 ? `, ${requests.length} pending` : ''}`}
          accessibilityRole="button"
          accessibilityState={{ selected: section === 'requests' }}
        >
          <Text style={[styles.toggleText, section === 'requests' && styles.toggleTextActive]}>
            🙋 Requests{requests.length > 0 ? ` (${requests.length})` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleButton, section === 'invitations' && styles.toggleButtonActive]}
          onPress={() => setSection('invitations')}
          accessibilityLabel={`Invites${combinedInvites.length > 0 ? `, ${combinedInvites.length} pending` : ''}`}
          accessibilityRole="button"
          accessibilityState={{ selected: section === 'invitations' }}
        >
          <Text style={[styles.toggleText, section === 'invitations' && styles.toggleTextActive]}>
            🤝 Invites{combinedInvites.length > 0 ? ` (${combinedInvites.length})` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleButton, section === 'reminders' && styles.toggleButtonActive]}
          onPress={() => setSection('reminders')}
          accessibilityLabel={`Reminders${reminders.length > 0 ? `, ${reminders.length} upcoming` : ''}`}
          accessibilityRole="button"
          accessibilityState={{ selected: section === 'reminders' }}
        >
          <Text style={[styles.toggleText, section === 'reminders' && styles.toggleTextActive]}>
            ⏰{reminders.length > 0 ? ` (${reminders.length})` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleButton, section === 'activity' && styles.toggleButtonActive]}
          onPress={() => setSection('activity')}
          accessibilityLabel="Activity"
          accessibilityRole="button"
          accessibilityState={{ selected: section === 'activity' }}
        >
          <Text style={[styles.toggleText, section === 'activity' && styles.toggleTextActive]}>🔔 Activity</Text>
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
                      <Text style={styles.groupChatChipText} numberOfLines={1}>{chat.title}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
            <MatchesScreen {...props} />
          </>
        )}
        {section === 'activity' && <ActivityScreen {...props} />}
        {section === 'invitations' && (
          <FlatList
            data={combinedInvites}
            keyExtractor={(item) => (item.kind === 'friend' ? `friend-${item.friendshipId}` : `social-${item.id}`)}
            contentContainerStyle={{ padding: spacing.lg }}
            refreshing={loadingInvitations || loadingSocialInvites}
            onRefresh={() => { loadInvitations(); loadSocialInvites(); }}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={styles.emptyEmoji}>🤝</Text>
                <Text style={styles.emptyText}>No pending invitations right now.</Text>
              </View>
            }
            renderItem={({ item }) => item.kind === 'friend' ? (
              <View style={styles.requestRow}>
                <View style={[styles.avatar, styles.avatarPlaceholder]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.requestName}>{item.display_name}</Text>
                  <Text style={styles.requestSubtitle}>wants to be friends</Text>
                </View>
                <TouchableOpacity
                  style={styles.approveButton}
                  onPress={() => handleRespondInvitation(item, true)}
                  accessibilityLabel={`Accept ${item.display_name}'s friend request`}
                  accessibilityRole="button"
                >
                  <Text style={styles.approveButtonText}>Accept</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.requestRow}>
                <View style={[styles.avatar, styles.avatarPlaceholder]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.requestName}>{item.inviterName}</Text>
                  <Text style={styles.requestSubtitle}>
                    invited you to {item.inviteType === 'gathering' ? 'a gathering' : 'a community'}: {item.targetTitle}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.declineButton}
                  onPress={() => handleRespondSocialInvite(item, false)}
                  accessibilityLabel={`Decline invite to ${item.targetTitle}`}
                  accessibilityRole="button"
                >
                  <Text style={styles.declineButtonText}>Decline</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.approveButton}
                  onPress={() => handleRespondSocialInvite(item, true)}
                  accessibilityLabel={`Accept invite to ${item.targetTitle}`}
                  accessibilityRole="button"
                >
                  <Text style={styles.approveButtonText}>Accept</Text>
                </TouchableOpacity>
              </View>
            )}
          />
        )}
        {section === 'requests' && (
          <FlatList
            data={requests}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: spacing.lg }}
            refreshing={loadingRequests}
            onRefresh={loadRequests}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={styles.emptyEmoji}>🙋</Text>
                <Text style={styles.emptyText}>No pending requests right now.</Text>
              </View>
            }
            renderItem={({ item }) => (
              <View style={styles.requestRow}>
                {photoUrls[item.id] ? (
                  <Image source={{ uri: photoUrls[item.id] }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarPlaceholder]} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.requestName}>{item.profiles?.display_name}</Text>
                  <Text style={styles.requestSubtitle}>wants to join {item.gatherings?.title}</Text>
                </View>
                <TouchableOpacity
                  style={styles.approveButton}
                  onPress={() => handleApprove(item)}
                  accessibilityLabel={`Approve ${item.profiles?.display_name}'s request`}
                  accessibilityRole="button"
                >
                  <Text style={styles.approveButtonText}>Approve</Text>
                </TouchableOpacity>
              </View>
            )}
          />
        )}
        {section === 'reminders' && (
          <FlatList
            data={reminders}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: spacing.lg }}
            refreshing={loadingReminders}
            onRefresh={loadReminders}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={styles.emptyEmoji}>⏰</Text>
                <Text style={styles.emptyText}>Nothing coming up in the next 24 hours.</Text>
              </View>
            }
            renderItem={({ item }) => (
              <View style={styles.requestRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.requestName}>{item.title}</Text>
                  <Text style={styles.requestSubtitle}>{item.role} · {formatTimeUntil(item.scheduledAt)}</Text>
                </View>
              </View>
            )}
          />
        )}
      </View>
    </SafeAreaView>
  );
}
const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  toggleRow: { flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  toggleButton: {
    flex: 1, paddingVertical: spacing.sm, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center',
  },
  toggleButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  toggleText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  toggleTextActive: { color: '#fff' },
  requestRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, marginRight: spacing.md },
  avatarPlaceholder: { backgroundColor: colors.surfaceElevated },
  requestName: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  requestSubtitle: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  approveButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  approveButtonText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  declineButton: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, marginRight: spacing.xs },
  declineButtonText: { color: colors.textSecondary, fontWeight: '700', fontSize: 12 },
  groupChatsRow: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  groupChatChip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, maxWidth: 160,
  },
  groupChatChipIcon: { fontSize: 14, marginRight: 4 },
  groupChatChipText: { color: colors.textPrimary, fontWeight: '600', fontSize: 13 },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl },
  emptyEmoji: { fontSize: 36, marginBottom: spacing.md },
  emptyText: { color: colors.textTertiary, textAlign: 'center' },
});