import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, FlatList, Image, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import MatchesScreen from './MatchesScreen';
import ActivityScreen from './ActivityScreen';
import { getAllPendingRequests, approveInterest } from '../services/gatherings';
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

  useFocusEffect(
    useCallback(() => {
      loadRequests();
    }, [loadRequests])
  );

  async function handleApprove(request) {
    try {
      await approveInterest(request.id);
      loadRequests();
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