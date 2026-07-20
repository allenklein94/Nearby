import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, Image, TouchableOpacity, StyleSheet, SafeAreaView, RefreshControl } from 'react-native';
import { getNearbyMatches, reportPresence } from '../services/proximity';
import { supabase } from '../services/supabase';
import { getSignedPhotoUrl } from '../services/photos';
import ReportBlockModal from '../components/ReportBlockModal';
import { colors, typography, spacing, radius, shadow } from '../theme';
import { usePostHog } from 'posthog-react-native';
import * as Haptics from 'expo-haptics';

export default function DiscoveryScreen({ navigation }) {
  const posthog = usePostHog();
  const [nearby, setNearby] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [reportTarget, setReportTarget] = useState(null);
  const [photoUrls, setPhotoUrls] = useState({});

  const load = useCallback(async () => {
    await reportPresence();
    const results = await getNearbyMatches();
    setNearby(results);

    const urlEntries = await Promise.all(
      results.map(async (item) => {
        const path = item.profiles?.photo_url;
        if (!path) return [item.id, null];
        const url = await getSignedPhotoUrl(path);
        return [item.id, url];
      })
    );
    setPhotoUrls(Object.fromEntries(urlEntries));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

async function sendNotice(toUserId) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const { data: sessionData } = await supabase.auth.getSession();
    const fromUserId = sessionData?.session?.user?.id;
    await supabase.from('notices').insert({ from_user: fromUserId, to_user: toUserId });
    posthog.capture('notice_sent');
  }

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Crossed Paths</Text>
        <Text style={styles.headerSubtitle}>People you've been near recently</Text>
      </View>

      <FlatList
        data={nearby}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: spacing.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>📍</Text>
            <Text style={styles.emptyTitle}>Nothing yet</Text>
            <Text style={styles.emptyText}>
              Keep the app open while you're out and about — we'll let
              you know when you cross paths with someone.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Image
              source={{ uri: photoUrls[item.id] || 'https://placehold.co/100' }}
              style={styles.avatar}
            />
            <View style={styles.cardInfo}>
              <Text style={styles.name}>{item.profiles?.display_name}</Text>
              <Text style={styles.bio} numberOfLines={2}>{item.profiles?.bio}</Text>
            </View>
            <View style={styles.cardActions}>
              <TouchableOpacity style={styles.noticeButton} onPress={() => sendNotice(item.otherUserId)} activeOpacity={0.85}>
                <Text style={styles.noticeButtonText}>Notice</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.moreButton}
                onPress={() => setReportTarget({ id: item.otherUserId, name: item.profiles?.display_name })}
              >
                <Text style={styles.moreButtonText}>⋯</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />

      <ReportBlockModal
        visible={!!reportTarget}
        onClose={() => {
          setReportTarget(null);
          load();
        }}
        reportedUserId={reportTarget?.id}
        reportedUserName={reportTarget?.name}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.lg },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  headerSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: 2 },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl, paddingHorizontal: spacing.xl },
  emptyEmoji: { fontSize: 40, marginBottom: spacing.md },
  emptyTitle: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.xs },
  emptyText: { ...typography.body, color: colors.textTertiary, textAlign: 'center' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  avatar: { width: 60, height: 60, borderRadius: radius.md, marginRight: spacing.md, backgroundColor: colors.surfaceElevated },
  cardInfo: { flex: 1 },
  name: { ...typography.bodyBold, color: colors.textPrimary },
  bio: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  cardActions: { alignItems: 'center' },
  noticeButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  noticeButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  moreButton: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  moreButtonText: { color: colors.textTertiary, fontSize: 18, fontWeight: '700' },
});