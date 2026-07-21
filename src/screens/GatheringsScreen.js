import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, SafeAreaView, RefreshControl, Alert, Image } from 'react-native';
import { getNearbyGatherings, getMyGatherings, expressInterest, approveInterest } from '../services/gatherings';
import { getSignedPhotoUrl } from '../services/photos';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius, shadow as shadowStatic } from '../theme';

export default function GatheringsScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [tab, setTab] = useState('nearby'); // 'nearby' or 'hosting'
  const [nearby, setNearby] = useState([]);
  const [hosting, setHosting] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [photoUrls, setPhotoUrls] = useState({});

  const load = useCallback(async () => {
    const [nearbyResults, hostingResults] = await Promise.all([
      getNearbyGatherings(),
      getMyGatherings(),
    ]);
    setNearby(nearbyResults);
    setHosting(hostingResults);

    const urlEntries = await Promise.all(
      nearbyResults.map(async (g) => {
        const path = g.host?.photo_url;
        if (!path) return [g.id, null];
        const url = await getSignedPhotoUrl(path);
        return [g.id, url];
      })
    );
    setPhotoUrls(Object.fromEntries(urlEntries));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function handleExpressInterest(gatheringId) {
    try {
      await expressInterest(gatheringId);
      Alert.alert("You're interested!", "The host will review and let you know.");
      load();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  async function handleApprove(interest, gathering) {
    try {
      await approveInterest(interest.id, gathering.id, gathering.host_id, interest.user_id);
      Alert.alert('Approved!', 'A match was created — you can now chat with them.');
      load();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Happening Nearby</Text>
        <TouchableOpacity style={styles.createButton} onPress={() => navigation.navigate('CreateGathering')}>
          <Text style={styles.createButtonText}>+ Host</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.tabRow}>
        <TouchableOpacity style={[styles.tab, tab === 'nearby' && styles.tabActive]} onPress={() => setTab('nearby')}>
          <Text style={[styles.tabText, tab === 'nearby' && styles.tabTextActive]}>Nearby</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'hosting' && styles.tabActive]} onPress={() => setTab('hosting')}>
          <Text style={[styles.tabText, tab === 'hosting' && styles.tabTextActive]}>Hosting</Text>
        </TouchableOpacity>
      </View>

      {tab === 'nearby' ? (
        <FlatList
          data={nearby}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing.lg }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>🎉</Text>
              <Text style={styles.emptyText}>Nothing happening nearby yet. Be the first to host something!</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardTopRow}>
                {photoUrls[item.id] && <Image source={{ uri: photoUrls[item.id] }} style={styles.hostAvatar} />}
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>{item.title}</Text>
                  <Text style={styles.hostName}>Hosted by {item.host?.display_name}</Text>
                </View>
              </View>
              {item.description ? <Text style={styles.description}>{item.description}</Text> : null}
              <Text style={styles.time}>{formatDate(item.scheduled_at)}</Text>
              <TouchableOpacity style={styles.interestButton} onPress={() => handleExpressInterest(item.id)} activeOpacity={0.85}>
                <Text style={styles.interestButtonText}>I'm Interested</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      ) : (
        <FlatList
          data={hosting}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing.lg }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>📅</Text>
              <Text style={styles.emptyText}>You're not hosting anything yet.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.time}>{formatDate(item.scheduled_at)}</Text>
              {item.interested?.length > 0 ? (
                item.interested.map((interest) => (
                  <View key={interest.id} style={styles.interestRow}>
                    <Text style={styles.interestName}>{interest.profiles?.display_name}</Text>
                    {interest.status === 'pending' ? (
                      <TouchableOpacity style={styles.approveButton} onPress={() => handleApprove(interest, item)}>
                        <Text style={styles.approveButtonText}>Approve</Text>
                      </TouchableOpacity>
                    ) : (
                      <Text style={styles.approvedLabel}>Approved ✓</Text>
                    )}
                  </View>
                ))
              ) : (
                <Text style={styles.noInterestText}>No one has expressed interest yet.</Text>
              )}
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  createButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  createButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  tabRow: { flexDirection: 'row', paddingHorizontal: spacing.lg, marginTop: spacing.md, gap: spacing.sm },
  tab: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.full, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { color: colors.textSecondary, fontWeight: '600', fontSize: 13 },
  tabTextActive: { color: '#fff' },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl },
  emptyEmoji: { fontSize: 40, marginBottom: spacing.md },
  emptyText: { ...typography.body, color: colors.textTertiary, textAlign: 'center' },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border, ...shadow.card,
  },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  hostAvatar: { width: 40, height: 40, borderRadius: radius.sm, marginRight: spacing.sm, backgroundColor: colors.surfaceElevated },
  title: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 16 },
  hostName: { ...typography.small, color: colors.textTertiary },
  description: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.sm },
  time: { ...typography.caption, color: colors.primary, fontWeight: '600', marginBottom: spacing.sm },
  interestButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 10, alignItems: 'center' },
  interestButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  interestRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.xs },
  interestName: { color: colors.textPrimary, fontSize: 14 },
  approveButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 6 },
  approveButtonText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  approvedLabel: { color: colors.success, fontSize: 12, fontWeight: '700' },
  noInterestText: { color: colors.textTertiary, fontSize: 13 },
});