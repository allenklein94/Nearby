import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, FlatList, Image, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import MatchesScreen from './MatchesScreen';
import ActivityScreen from './ActivityScreen';
import { getAllPendingRequests, approveInterest, getUpcomingReminders } from '../services/gatherings';
import { getPendingFriendRequests, respondToFriendRequest } from '../services/friends';
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
  const [reminders, setReminders] = useState([]);
  const [loadingReminders, setLoadingReminders] = useState(true);

  const loadRequests = useCallback(async () => {
    const results = await getAllPendingRequests();
    setRequests(results);
    setLoadingRequests(false);
    const urlEntries = await Promise.all(
      results.map(async (r) => {
        const path = r.profiles?.photo_url;
        if (!path) return [r.id, null];
        const url = await getSignedPhotoUrl(path);
        return [r.id, url];
      })
    );
    setPhotoUrls(Object.fromEntries(urlEntries));
  }, []);

  const loadInvitations = useCallback(async () => {
    const results = await getPendingFriendRequests();
    setInvitations(results);
    setLoadingInvitations(false);
  }, []);

  const loadReminders = useCallback(async () => {
    const results = await getUpcomingReminders();
    setReminders(results);
    setLoadingReminders(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadRequests();
      loadInvitations();
      loadReminders();
    }, [loadRequests, loadInvitations, loadReminders])
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
          accessibilityLabel={`Invitations${invitations.length > 0 ? `, ${invitations.length} pending` : ''}`}
          accessibilityRole="button"
          accessibilityState={{ selected: section === 'invitations' }}
        >
          <Text style={[styles.toggleText, section === 'invitations' && styles.toggleTextActive]}>
            🤝 Invites{invitations.length > 0 ? ` (${invitations.length})` : ''}
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
        {section === 'messages' && <MatchesScreen {...props} />}
        {section === 'activity' && <ActivityScreen {...props} />}
        {section === 'invitations' && (
          <FlatList
            data={invitations}
            keyExtractor={(item) => item.friendshipId}
            contentContainerStyle={{ padding: spacing.lg }}
            refreshing={loadingInvitations}
            onRefresh={loadInvitations}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={styles.emptyEmoji}>🤝</Text>
                <Text style={styles.emptyText}>No pending friend invitations right now.</Text>
              </View>
            }
            renderItem={({ item }) => (
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
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl },
  emptyEmoji: { fontSize: 36, marginBottom: spacing.md },
  emptyText: { color: colors.textTertiary, textAlign: 'center' },
});